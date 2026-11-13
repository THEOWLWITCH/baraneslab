import io, os, math, time, json, traceback
from pathlib import Path
import requests
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon
from sklearn.decomposition import PCA
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.metrics import r2_score
from meshparty import meshwork

RNG = np.random.default_rng(20261113)
OUT = Path("model8_microns_results")
OUT.mkdir(exist_ok=True)

VERSION = 661
CC_MIN = 0.30
MAX_ANALYZABLE_CELLS = 80
MAX_DOWNLOAD_ATTEMPTS = 250
MIN_FUNCTIONAL_PRE = 6
N_Q1_PERM = 1000
N_Q2_SHUFFLES = 100
PCA_DIM = 16

STATIC_BASE = f"https://storage.googleapis.com/mat_dbs/public/minnie65_phase3_v1/v{VERSION}"
DT_BASE = "https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/functional_data/digital_twin_properties/v2"
MESH_BASE = "https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/skeletons/v661/meshworks"

session = requests.Session()
session.headers.update({"User-Agent":"Model8-MICrONS-analysis/1.0"})

def download_bytes(url, timeout=180):
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.content

def download_file(url, path, timeout=600):
    with session.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8*1024*1024):
                if chunk:
                    f.write(chunk)

def static_table(name):
    h = download_bytes(f"{STATIC_BASE}/{name}_merged_header.csv")
    header = pd.read_csv(io.BytesIO(h), header=None, names=["column","type"])
    d = download_bytes(f"{STATIC_BASE}/{name}_merged.csv.gz", timeout=600)
    df = pd.read_csv(io.BytesIO(d), compression="gzip", header=None, low_memory=False)
    df.columns = header["column"].tolist()
    return df

def load_functional():
    coreg = static_table("coregistration_manual_v3")
    proof = static_table("proofreading_status_public_release")
    nuc = static_table("nucleus_detection_lookup_v1")

    perf = pd.read_csv(io.BytesIO(download_bytes(f"{DT_BASE}/performance/units.csv")))
    ori = pd.read_csv(io.BytesIO(download_bytes(f"{DT_BASE}/ori_dir_tuning/units.csv")))
    rloc_url = f"{DT_BASE}/readout/readout_locations.npy"
    runits = pd.read_csv(io.BytesIO(download_bytes(f"{DT_BASE}/readout/units.csv")))

    loc_path = Path("/tmp/readout_locations.npy")
    if not loc_path.exists():
        download_file(rloc_url, loc_path)
    locations = np.load(loc_path, mmap_mode="r")
    runits = runits.copy()
    runits["readout_row"] = np.arange(len(runits))
    loc_df = runits.copy()
    loc_df["readout_loc_x"] = np.asarray(locations[:,0], dtype=float)
    loc_df["readout_loc_y"] = np.asarray(locations[:,1], dtype=float)

    keys = ["session","scan_idx","unit_id"]
    f = (coreg.merge(perf, on=keys, how="left")
               .merge(ori, on=keys, how="left", suffixes=("","_ori"))
               .merge(loc_df[keys+["readout_row","readout_loc_x","readout_loc_y"]], on=keys, how="left"))

    for c in ["pt_root_id","session","scan_idx","unit_id"]:
        f[c] = pd.to_numeric(f[c], errors="coerce")
    f = f.dropna(subset=["pt_root_id","readout_row"]).copy()
    f["pt_root_id"] = f["pt_root_id"].astype(np.uint64)
    f["readout_row"] = f["readout_row"].astype(int)
    f["cc_norm"] = pd.to_numeric(f["cc_norm"], errors="coerce")

    # one functional ROI per EM root: highest digital-twin quality
    f = (f.sort_values(["pt_root_id","cc_norm"], ascending=[True,False], na_position="last")
          .drop_duplicates("pt_root_id", keep="first"))

    proof = proof.copy()
    proof["pt_root_id"] = pd.to_numeric(proof["pt_root_id"], errors="coerce")
    proof = proof.dropna(subset=["pt_root_id"])
    proof["pt_root_id"] = proof["pt_root_id"].astype(np.uint64)
    proof["dendrite_proofread"] = proof["status_dendrite"].astype(str).isin(["clean","extended"])

    nuc = nuc.copy()
    nuc["pt_root_id"] = pd.to_numeric(nuc["pt_root_id"], errors="coerce")
    nuc = nuc.dropna(subset=["pt_root_id"])
    nuc["pt_root_id"] = nuc["pt_root_id"].astype(np.uint64)
    nuc = nuc[nuc["pt_root_id"] != 0].drop_duplicates("pt_root_id")

    f = f.merge(proof[["pt_root_id","status_dendrite","dendrite_proofread"]], on="pt_root_id", how="left")
    f["dendrite_proofread"] = f["dendrite_proofread"].fillna(False)
    f = f.merge(nuc[["pt_root_id","id"]].rename(columns={"id":"nucleus_id"}), on="pt_root_id", how="left")

    return f, runits

def get_readout_weights():
    p = Path("/tmp/readout_weights.npy")
    if not p.exists():
        print("Downloading 512-D digital-twin readout weights...")
        download_file(f"{DT_BASE}/readout/readout_weights.npy", p, timeout=1800)
    return np.load(p, mmap_mode="r")

def norm_rows(x):
    x = np.asarray(x, dtype=float)
    n = np.linalg.norm(x, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return x / n

def cosine(a,b):
    a=np.asarray(a,float); b=np.asarray(b,float)
    na=np.linalg.norm(a); nb=np.linalg.norm(b)
    if na==0 or nb==0: return np.nan
    return float(np.dot(a,b)/(na*nb))

def ori_sim(a,b):
    if not (np.isfinite(a) and np.isfinite(b)): return np.nan
    # preferred orientation is degrees, periodic at 180
    return float(np.cos(np.deg2rad(2*(float(a)-float(b)))))

def locate_mesh(root_id, nucleus_id):
    if not np.isfinite(nucleus_id):
        return None
    return f"{MESH_BASE}/{int(root_id)}_{int(nucleus_id)}.h5"

def analyze_mesh(root_id, nucleus_id, func_by_root, tmpdir):
    url = locate_mesh(root_id, nucleus_id)
    if url is None:
        return None, "no_nucleus"
    path = Path(tmpdir) / f"{int(root_id)}.h5"
    try:
        r = session.get(url, stream=True, timeout=240)
        if r.status_code == 404:
            return None, "mesh_404"
        r.raise_for_status()
        with open(path,"wb") as f:
            for ch in r.iter_content(4*1024*1024):
                if ch: f.write(ch)
        mw = meshwork.load_meshwork(path)

        if "post_syn" not in mw.anno.table_names:
            return None, "no_post_syn"
        ann = mw.anno.post_syn
        df = ann.df.copy().reset_index(drop=True)
        if "pre_pt_root_id" not in df.columns or len(df)==0:
            return None, "no_pre_ids"
        skidx = np.asarray(ann.skel_index).astype(int).reshape(-1)
        if len(skidx) != len(df):
            return None, "skidx_mismatch"

        segmap = np.asarray(mw.skeleton.segment_map, dtype=int)
        valid = (skidx >= 0) & (skidx < len(segmap))
        df = df.loc[valid].copy().reset_index(drop=True)
        skidx = skidx[valid]
        df["branch_id"] = segmap[skidx]

        # Exclude root-containing segment.
        root_seg = int(segmap[int(mw.skeleton.root)])
        df = df[df["branch_id"] != root_seg].copy()

        df["pre_pt_root_id"] = pd.to_numeric(df["pre_pt_root_id"], errors="coerce")
        df = df.dropna(subset=["pre_pt_root_id"])
        df["pre_pt_root_id"] = df["pre_pt_root_id"].astype(np.uint64)
        df = df[df["pre_pt_root_id"].isin(func_by_root.keys())]
        if len(df)==0:
            return None, "no_functional_inputs"

        # One connection-level record per presynaptic partner.
        rows=[]
        for pre, g in df.groupby("pre_pt_root_id"):
            # actual branch allocation from all contacts
            byb=(g.groupby("branch_id")
                   .agg(n_syn=("id","nunique"), total_size=("size","sum"))
                   .reset_index())
            byb=byb.sort_values(["n_syn","total_size","branch_id"], ascending=[False,False,True])
            dominant=int(byb.iloc[0]["branch_id"])
            rows.append({
                "post_pt_root_id":int(root_id),
                "pre_pt_root_id":int(pre),
                "n_synapses":int(g["id"].nunique()),
                "total_size":float(pd.to_numeric(g["size"],errors="coerce").fillna(0).sum()),
                "dominant_branch":dominant,
                "branch_ids":tuple(map(int,byb["branch_id"].tolist())),
                "branch_counts":tuple(map(float,byb["n_syn"].tolist())),
                "branch_sizes":tuple(map(float,byb["total_size"].tolist())),
            })
        conn=pd.DataFrame(rows)
        return conn, "ok"
    except Exception as e:
        return None, f"error:{type(e).__name__}:{e}"
    finally:
        try:
            if path.exists(): path.unlink()
        except Exception:
            pass

def q1_pairs(cell_connections, func_by_root, weights):
    rows=[]
    for post, g in cell_connections.groupby("post_pt_root_id"):
        g=g.reset_index(drop=True)
        if len(g) < MIN_FUNCTIONAL_PRE: continue
        for i in range(len(g)):
            a=g.iloc[i]; ra=int(a.pre_pt_root_id)
            fa=func_by_root.get(ra)
            if fa is None: continue
            va=np.asarray(weights[int(fa["readout_row"])], dtype=float)
            for j in range(i+1,len(g)):
                b=g.iloc[j]; rb=int(b.pre_pt_root_id)
                fb=func_by_root.get(rb)
                if fb is None: continue
                vb=np.asarray(weights[int(fb["readout_row"])], dtype=float)
                rows.append({
                    "post_pt_root_id":int(post),
                    "pre_i":ra, "pre_j":rb,
                    "same_dominant_branch":int(a.dominant_branch)==int(b.dominant_branch),
                    "share_any_branch":bool(set(a.branch_ids).intersection(set(b.branch_ids))),
                    "readout_cosine":cosine(va,vb),
                    "orientation_similarity":ori_sim(float(fa.get("pref_ori",np.nan)), float(fb.get("pref_ori",np.nan))),
                })
    return pd.DataFrame(rows)

def q1_cell_deltas(pairs, same_col="same_dominant_branch", metric="readout_cosine"):
    out=[]
    for post,g in pairs.groupby("post_pt_root_id"):
        s=g.loc[g[same_col],metric].dropna()
        d=g.loc[~g[same_col],metric].dropna()
        if len(s)>=2 and len(d)>=2:
            out.append({"post_pt_root_id":int(post),"same_mean":float(s.mean()),"different_mean":float(d.mean()),
                        "delta":float(s.mean()-d.mean()),"n_same":len(s),"n_diff":len(d)})
    return pd.DataFrame(out)

def q1_permutation(cell_connections, func_by_root, weights, observed_delta, nperm=N_Q1_PERM):
    # Cache normalized functional vectors and geometry per post.
    cells=[]
    for post,g in cell_connections.groupby("post_pt_root_id"):
        g=g.reset_index(drop=True)
        if len(g)<MIN_FUNCTIONAL_PRE: continue
        roots=[int(x) for x in g.pre_pt_root_id]
        vecs=[]
        oris=[]
        for r in roots:
            f=func_by_root[r]
            v=np.asarray(weights[int(f["readout_row"])],float)
            nv=np.linalg.norm(v)
            vecs.append(v/(nv if nv else 1))
            oris.append(float(f.get("pref_ori",np.nan)))
        branches=np.asarray(g.dominant_branch,dtype=int)
        cells.append((int(post),np.vstack(vecs),np.asarray(oris),branches))
    null=[]
    for _ in range(nperm):
        deltas=[]
        for post,V,O,B in cells:
            p=RNG.permutation(len(V))
            Vp=V[p]
            same=[]; diff=[]
            for i in range(len(Vp)):
                for j in range(i+1,len(Vp)):
                    sim=float(np.dot(Vp[i],Vp[j]))
                    (same if B[i]==B[j] else diff).append(sim)
            if len(same)>=2 and len(diff)>=2:
                deltas.append(np.mean(same)-np.mean(diff))
        null.append(float(np.mean(deltas)) if deltas else np.nan)
    vals=np.asarray(null,float); vals=vals[np.isfinite(vals)]
    p=(1+np.sum(vals>=observed_delta))/(1+len(vals)) if len(vals) and np.isfinite(observed_delta) else np.nan
    return vals,p

def parse_profile(row, scheme):
    branches=list(row.branch_ids)
    vals=list(row.branch_sizes if scheme=="size" else row.branch_counts)
    return branches, np.asarray(vals,float)

def make_q2_cell_features(cell_connections, func_by_root, pc_by_root, scheme="size", shuffle_profiles=False):
    rows=[]
    for post,g in cell_connections.groupby("post_pt_root_id"):
        post=int(post)
        if post not in pc_by_root: continue
        g=g.reset_index(drop=True)
        if len(g)<MIN_FUNCTIONAL_PRE: continue

        pre_roots=[int(x) for x in g.pre_pt_root_id]
        if not all(r in pc_by_root for r in pre_roots): continue
        P=np.vstack([pc_by_root[r] for r in pre_roots])

        # Each row: total weight + normalized branch allocation profile.
        all_branches=sorted(set(b for x in g.branch_ids for b in x))
        if len(all_branches)<2: continue
        bidx={b:k for k,b in enumerate(all_branches)}
        W=np.zeros((len(g),len(all_branches)),float)
        for i,r in g.iterrows():
            bs,vals=parse_profile(r,scheme)
            for b,v in zip(bs,vals):
                if np.isfinite(v) and v>0: W[i,bidx[b]] += v
        totals=W.sum(axis=1)
        keep=totals>0
        if keep.sum()<MIN_FUNCTIONAL_PRE: continue
        W=W[keep]; P=P[keep]; totals=totals[keep]
        if W.sum()<=0: continue
        # normalize global scale, preserve each connection total and branch profile
        W=W/W.sum()
        totals=W.sum(axis=1)
        profiles=np.zeros_like(W)
        nz=totals>0
        profiles[nz]=W[nz]/totals[nz,None]

        if shuffle_profiles:
            profiles=profiles[RNG.permutation(len(profiles))]
            W=totals[:,None]*profiles

        # graph information: identical for true/shuffled
        L=(totals[:,None]*P).sum(axis=0)
        G2=L*np.abs(L)
        # branch-local nonlinear pooling
        B=W.T @ P
        Q=(B*np.abs(B)).sum(axis=0)

        feat=np.concatenate([L,G2,Q,[math.log1p(len(P)), math.log1p(float(W.sum()))]])
        rows.append({"post_pt_root_id":post, "features":feat, "target":pc_by_root[post]})
    return rows

def cv_multi(rows, include_q=True, seed=11):
    if len(rows)<20:
        return {"n":len(rows),"r2":np.nan,"cosine":np.nan}, None
    X=np.vstack([r["features"] for r in rows])
    Y=np.vstack([r["target"] for r in rows])
    # graph-only drops the branch-local Q block (third PCA_DIM block)
    if not include_q:
        keep=np.r_[np.arange(0,2*PCA_DIM), np.arange(3*PCA_DIM,3*PCA_DIM+2)]
        X=X[:,keep]
    k=min(5,len(rows))
    cv=KFold(n_splits=k,shuffle=True,random_state=seed)
    pred=np.full_like(Y,np.nan,float)
    for tr,te in cv.split(X):
        model=Pipeline([
            ("impute",SimpleImputer(strategy="median")),
            ("scale",StandardScaler()),
            ("ridge",RidgeCV(alphas=np.logspace(-4,4,25)))
        ])
        model.fit(X[tr],Y[tr])
        pred[te]=model.predict(X[te])
    r2=float(r2_score(Y,pred,multioutput="variance_weighted"))
    cos=[]
    for y,p in zip(Y,pred):
        ny=np.linalg.norm(y); np_=np.linalg.norm(p)
        if ny and np_: cos.append(float(np.dot(y,p)/(ny*np_)))
    return {"n":len(rows),"r2":r2,"cosine":float(np.mean(cos)) if cos else np.nan}, pred

def main():
    status=[]
    print("Loading public static MICrONS tables and functional properties...")
    f, runits = load_functional()
    weights = get_readout_weights()

    # Functional quality filter for both pre and post.
    fgood=f[(f["cc_norm"].notna()) & (f["cc_norm"]>=CC_MIN)].copy()
    fgood=fgood[fgood["readout_row"].between(0,weights.shape[0]-1)]
    func_by_root={int(r.pt_root_id):r.to_dict() for _,r in fgood.iterrows()}

    print(f"Manual coreg roots with cc_norm >= {CC_MIN}: {len(func_by_root)}")
    print(f"Proofread dendrites among them: {int(fgood.dendrite_proofread.sum())}")

    # Prioritize proofread dendrites; use non-proofread only after primary sample exhausted.
    cand=fgood[fgood["nucleus_id"].notna()].copy()
    cand["priority"]=(~cand["dendrite_proofread"]).astype(int)
    cand=cand.sort_values(["priority","cc_norm"],ascending=[True,False])

    all_conn=[]
    audit=[]
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        attempts=0; analyzable=0
        for _,r in cand.iterrows():
            if attempts>=MAX_DOWNLOAD_ATTEMPTS or analyzable>=MAX_ANALYZABLE_CELLS: break
            attempts+=1
            root=int(r.pt_root_id); nuc=int(r.nucleus_id)
            t0=time.time()
            conn,why=analyze_mesh(root,nuc,func_by_root,td)
            rec={"post_pt_root_id":root,"nucleus_id":nuc,"dendrite_proofread":bool(r.dendrite_proofread),
                 "cc_norm":float(r.cc_norm),"status":why,"seconds":time.time()-t0,
                 "n_functional_pre":0,"n_branches":0}
            if conn is not None and len(conn):
                rec["n_functional_pre"]=int(conn.pre_pt_root_id.nunique())
                rec["n_branches"]=int(conn.dominant_branch.nunique())
                if rec["n_functional_pre"]>=MIN_FUNCTIONAL_PRE and rec["n_branches"]>=2:
                    analyzable+=1
                    all_conn.append(conn)
                    rec["analyzable"]=True
                else:
                    rec["analyzable"]=False
            audit.append(rec)
            print(f"[{attempts}] post {root}: {why}, functional pre={rec['n_functional_pre']}, branches={rec['n_branches']}, analyzable={analyzable}")
    audit_df=pd.DataFrame(audit)
    audit_df.to_csv(OUT/"mesh_audit.csv",index=False)

    if not all_conn:
        raise RuntimeError("No analyzable functionally coregistered postsynaptic cells found.")

    conns=pd.concat(all_conn,ignore_index=True)
    conns.to_pickle(OUT/"connection_branch_profiles.pkl")

    # Primary results restricted to proofread postsynaptic dendrites if sufficient.
    proof_posts=set(audit_df.loc[(audit_df.get("analyzable",False)==True)&(audit_df.dendrite_proofread==True),"post_pt_root_id"].astype(int))
    if len(proof_posts)>=12:
        primary_conns=conns[conns.post_pt_root_id.isin(proof_posts)].copy()
        primary_scope="proofread_dendrites"
    else:
        primary_conns=conns.copy()
        primary_scope="all_available_meshworks"

    # Q1
    pairs=q1_pairs(primary_conns,func_by_root,weights)
    pairs.to_csv(OUT/"q1_pair_table.csv",index=False)
    cell_delta=q1_cell_deltas(pairs,"same_dominant_branch","readout_cosine")
    cell_delta.to_csv(OUT/"q1_cell_deltas.csv",index=False)
    obs=float(cell_delta.delta.mean()) if len(cell_delta) else np.nan
    null,pperm=q1_permutation(primary_conns,func_by_root,weights,obs)
    np.savetxt(OUT/"q1_permutation_null.csv",null,delimiter=",")
    if len(cell_delta)>=2:
        try:
            wres=wilcoxon(cell_delta.delta, alternative="greater", zero_method="wilcox")
            pw=float(wres.pvalue)
        except Exception:
            pw=np.nan
    else: pw=np.nan
    ori_delta=q1_cell_deltas(pairs,"same_dominant_branch","orientation_similarity")

    q1_summary=pd.DataFrame([{
        "scope":primary_scope,
        "n_postsynaptic_cells":int(primary_conns.post_pt_root_id.nunique()),
        "n_pair_rows":int(len(pairs)),
        "n_cells_with_same_and_different_pairs":int(len(cell_delta)),
        "same_branch_readout_similarity_mean":float(pairs.loc[pairs.same_dominant_branch,"readout_cosine"].mean()),
        "different_branch_readout_similarity_mean":float(pairs.loc[~pairs.same_dominant_branch,"readout_cosine"].mean()),
        "equal_cell_weight_delta":obs,
        "permutation_p":pperm,
        "wilcoxon_cell_delta_p":pw,
        "median_cell_delta":float(cell_delta.delta.median()) if len(cell_delta) else np.nan,
        "orientation_equal_cell_weight_delta":float(ori_delta.delta.mean()) if len(ori_delta) else np.nan,
        "n_orientation_cells":int(len(ori_delta)),
    }])
    q1_summary.to_csv(OUT/"q1_summary.csv",index=False)

    # Q2: PCA of normalized 512-D functional representations.
    all_roots=sorted(func_by_root.keys())
    V=np.vstack([np.asarray(weights[int(func_by_root[r]["readout_row"])],float) for r in all_roots])
    V=norm_rows(V)
    pca=PCA(n_components=PCA_DIM, random_state=20261113)
    Z=pca.fit_transform(V)
    pc_by_root={r:Z[i] for i,r in enumerate(all_roots)}
    pd.DataFrame({"explained_variance_ratio":pca.explained_variance_ratio_}).to_csv(OUT/"q2_pca_variance.csv",index=False)

    q2_rows=[]
    q2_null_rows=[]
    for scheme in ["size","count"]:
        true_rows=make_q2_cell_features(primary_conns,func_by_root,pc_by_root,scheme=scheme,shuffle_profiles=False)
        graph_score,_=cv_multi(true_rows,include_q=False,seed=17)
        true_score,_=cv_multi(true_rows,include_q=True,seed=17)
        null_scores=[]
        for s in range(N_Q2_SHUFFLES):
            sr=make_q2_cell_features(primary_conns,func_by_root,pc_by_root,scheme=scheme,shuffle_profiles=True)
            sc,_=cv_multi(sr,include_q=True,seed=17)
            null_scores.append(sc)
            q2_null_rows.append({"scheme":scheme,"shuffle":s,"r2":sc["r2"],"cosine":sc["cosine"],"n":sc["n"]})
        nr2=np.array([x["r2"] for x in null_scores],float)
        ncos=np.array([x["cosine"] for x in null_scores],float)
        p_r2=(1+np.sum(nr2>=true_score["r2"]))/(1+np.sum(np.isfinite(nr2))) if np.isfinite(true_score["r2"]) else np.nan
        p_cos=(1+np.sum(ncos>=true_score["cosine"]))/(1+np.sum(np.isfinite(ncos))) if np.isfinite(true_score["cosine"]) else np.nan
        q2_rows.append({
            "scope":primary_scope,"scheme":scheme,"n_postsynaptic_cells":true_score["n"],
            "graph_only_r2":graph_score["r2"],"true_dendrite_r2":true_score["r2"],
            "shuffled_dendrite_mean_r2":float(np.nanmean(nr2)),
            "true_minus_graph_r2":true_score["r2"]-graph_score["r2"],
            "true_minus_shuffled_mean_r2":true_score["r2"]-float(np.nanmean(nr2)),
            "shuffle_p_r2":p_r2,
            "graph_only_cosine":graph_score["cosine"],"true_dendrite_cosine":true_score["cosine"],
            "shuffled_dendrite_mean_cosine":float(np.nanmean(ncos)),
            "true_minus_graph_cosine":true_score["cosine"]-graph_score["cosine"],
            "true_minus_shuffled_mean_cosine":true_score["cosine"]-float(np.nanmean(ncos)),
            "shuffle_p_cosine":p_cos,
        })
    pd.DataFrame(q2_rows).to_csv(OUT/"q2_summary.csv",index=False)
    pd.DataFrame(q2_null_rows).to_csv(OUT/"q2_shuffle_null.csv",index=False)

    # Compact human-readable report
    q1=q1_summary.iloc[0].to_dict()
    q2=pd.DataFrame(q2_rows)
    with open(OUT/"RESULTS.txt","w") as fh:
        fh.write("MODEL 8 — MICrONS PUBLIC STATIC-DATA ANALYSIS\n")
        fh.write("="*60+"\n\n")
        fh.write(f"Dataset: MICrONS static v661 meshworks + manual functional coregistration + digital-twin v2 readout features.\n")
        fh.write(f"Functional quality threshold: cc_norm >= {CC_MIN}.\n")
        fh.write(f"Primary scope: {primary_scope}.\n")
        fh.write(f"Analyzable postsynaptic cells: {int(primary_conns.post_pt_root_id.nunique())}.\n\n")
        fh.write("QUESTION 1 — functional similarity on same dendritic branch\n")
        for k,v in q1.items(): fh.write(f"{k}: {v}\n")
        fh.write("\nQUESTION 2 — does true dendritic organization add predictive functional information?\n")
        fh.write(q2.to_string(index=False))
        fh.write("\n\nInterpretation rule: Q2's central comparison is TRUE dendritic organization versus graph-preserving SHUFFLED dendritic organization; graph-only is secondary because the dendritic model has an additional branch-local feature block.\n")

    print("\n=== Q1 ===")
    print(q1_summary.to_string(index=False))
    print("\n=== Q2 ===")
    print(pd.DataFrame(q2_rows).to_string(index=False))

if __name__=="__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        with open(OUT/"FAILED.txt","w") as f:
            f.write(traceback.format_exc())
        raise
