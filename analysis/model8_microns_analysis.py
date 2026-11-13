import io, json, math, os, tempfile, traceback, warnings
from pathlib import Path
import requests
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import KFold
from sklearn.metrics import r2_score
from meshparty import meshwork

warnings.filterwarnings("ignore")
OUT=Path("model8_microns_results"); OUT.mkdir(exist_ok=True)
BASE="https://s3.amazonaws.com/bossdb-open-data/iarpa_microns/minnie/functional_data/functional_connectomics/node_and_edge_properties/v1"
STATIC="https://storage.googleapis.com/mat_dbs/public/minnie65_phase3_v1/v661"
MESH="https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/skeletons/v661/meshworks"
RNG=np.random.default_rng(20261113)
MAX_ANALYZED_POSTS=80
MIN_PRE=3
N_PERM=2000
N_SHUFFLE=100

def get(url,path,timeout=600):
    p=Path(path)
    if not p.exists():
        with requests.get(url,stream=True,timeout=timeout) as r:
            r.raise_for_status()
            with open(p,"wb") as f:
                for chunk in r.iter_content(1024*1024):
                    if chunk: f.write(chunk)
    return p

def load_static(table):
    h=requests.get(f"{STATIC}/{table}_merged_header.csv",timeout=120); h.raise_for_status()
    d=requests.get(f"{STATIC}/{table}_merged.csv.gz",timeout=600); d.raise_for_status()
    header=pd.read_csv(io.BytesIO(h.content),header=None,names=["column","type"])
    df=pd.read_csv(io.BytesIO(d.content),compression="gzip",header=None,low_memory=False)
    df.columns=header["column"].tolist()
    return df

def arr(x):
    try:
        a=np.asarray(x,dtype=float).reshape(-1)
        return a if a.size else None
    except Exception:
        return None

def cosine(a,b):
    a=arr(a); b=arr(b)
    if a is None or b is None or a.shape!=b.shape: return np.nan
    m=np.isfinite(a)&np.isfinite(b)
    if m.sum()<3: return np.nan
    aa=a[m]; bb=b[m]; na=np.linalg.norm(aa); nb=np.linalg.norm(bb)
    if na==0 or nb==0: return np.nan
    return float(np.dot(aa,bb)/(na*nb))

def corr(a,b):
    a=arr(a); b=arr(b)
    if a is None or b is None or a.shape!=b.shape: return np.nan
    m=np.isfinite(a)&np.isfinite(b)
    if m.sum()<5: return np.nan
    aa=a[m]; bb=b[m]
    if np.std(aa)==0 or np.std(bb)==0: return np.nan
    return float(np.corrcoef(aa,bb)[0,1])

def circ_ori_sim(a,b):
    try:
        if not np.isfinite(float(a)) or not np.isfinite(float(b)): return np.nan
        return float(np.cos(np.deg2rad(2*(float(a)-float(b)))))
    except Exception:
        return np.nan

def mean_ci(values,nboot=5000):
    v=np.asarray(values,dtype=float); v=v[np.isfinite(v)]
    if len(v)==0: return (np.nan,np.nan,np.nan)
    boots=np.array([np.mean(RNG.choice(v,size=len(v),replace=True)) for _ in range(nboot)])
    return float(np.mean(v)),float(np.quantile(boots,.025)),float(np.quantile(boots,.975))

def perm_p(observed,null,greater=True):
    null=np.asarray(null,dtype=float); null=null[np.isfinite(null)]
    if not np.isfinite(observed) or len(null)==0: return np.nan
    return float((1+np.sum(null>=observed if greater else null<=observed))/(1+len(null)))

# Public functional-connectomics release
get(f"{BASE}/node_data_v1.pkl","/tmp/node.pkl")
get(f"{BASE}/edge_data_v1.pkl","/tmp/edge.pkl")
node=pd.read_pickle("/tmp/node.pkl")
edge=pd.read_pickle("/tmp/edge.pkl")
node=node.drop_duplicates("nucleus_id").set_index("nucleus_id",drop=False)
connected=edge.query("n_synapses > 0").copy()

# Stable nucleus-id <-> v661 root-id map
nuc=load_static("nucleus_detection_v0")
nuc=nuc[["id","pt_root_id"]].dropna().drop_duplicates("id")
nid_to_root=dict(zip(nuc["id"].astype(int),nuc["pt_root_id"].astype("uint64").astype(int)))
root_to_nid=dict(zip(nuc["pt_root_id"].astype("uint64").astype(int),nuc["id"].astype(int)))

# Rank candidates by number of functionally characterized connected presynaptic cells.
cand=(connected.groupby("post_nucleus_id")
      .agg(n_functional_pre=("pre_nucleus_id","nunique"), edge_synapses=("n_synapses","sum"))
      .query("n_functional_pre >= @MIN_PRE")
      .sort_values(["n_functional_pre","edge_synapses"],ascending=False)
      .reset_index())
cand["post_root_id"]=cand["post_nucleus_id"].map(nid_to_root)
cand["post_is_functional"]=cand["post_nucleus_id"].isin(node.index)
cand.to_csv(OUT/"candidate_posts.csv",index=False)

# Basic functional vector shapes
shape_rows=[]
for col in ["readout_cvt","in_silico_resp","in_vivo_mean_resp"]:
    shapes=node[col].map(lambda x: None if arr(x) is None else tuple(arr(x).shape))
    vc=shapes.value_counts(dropna=False)
    for shp,n in vc.head(20).items():
        shape_rows.append({"variable":col,"shape":str(shp),"n":int(n)})
pd.DataFrame(shape_rows).to_csv(OUT/"functional_vector_shapes.csv",index=False)

branch_rows=[]
cell_rows=[]
fail_rows=[]
available_checked=0
analyzed=0

for cr in cand.itertuples(index=False):
    if analyzed>=MAX_ANALYZED_POSTS: break
    post_nid=int(cr.post_nucleus_id)
    post_root=nid_to_root.get(post_nid)
    if post_root is None: continue
    url=f"{MESH}/{post_root}_{post_nid}.h5"
    available_checked+=1
    try:
        h=requests.head(url,timeout=30,allow_redirects=True)
        if h.status_code!=200: continue
        local=f"/tmp/mw_{post_nid}.h5"
        get(url,local,timeout=600)
        mw=meshwork.load_meshwork(local)
        if not hasattr(mw.anno,"post_syn"): continue
        sdf=mw.anno.post_syn.df.copy().reset_index(drop=True)
        skidx=np.asarray(mw.anno.post_syn.mesh_index.to_skel_index_padded).astype(int).reshape(-1)
        if len(sdf)!=len(skidx):
            raise RuntimeError(f"post_syn/skel index length mismatch {len(sdf)} {len(skidx)}")
        segmap=np.asarray(mw.skeleton.segment_map).astype(int)
        rootseg=int(segmap[int(mw.skeleton.root)])
        sdf["skel_index"]=skidx
        sdf=sdf[sdf["skel_index"]>=0].copy()
        sdf["branch_id"]=segmap[sdf["skel_index"].astype(int).to_numpy()]
        sdf=sdf[sdf["branch_id"]!=rootseg].copy()
        # Exclude axonal skeleton vertices if annotation is present.
        if hasattr(mw.anno,"is_axon"):
            ax=set(np.asarray(mw.anno.is_axon.skel_index).astype(int).reshape(-1).tolist())
            sdf=sdf[~sdf["skel_index"].isin(ax)].copy()
        sdf["pre_nucleus_id"]=sdf["pre_pt_root_id"].map(lambda x: root_to_nid.get(int(x)) if pd.notna(x) else None)
        target_pre=set(connected.loc[connected.post_nucleus_id==post_nid,"pre_nucleus_id"].astype(int))
        sdf=sdf[sdf["pre_nucleus_id"].isin(target_pre)].copy()
        if len(sdf)==0: continue
        # exact branch allocation by pre partner
        gb=(sdf.groupby(["pre_nucleus_id","branch_id"],as_index=False)
              .agg(branch_n_syn=("id","nunique"),branch_size=("size","sum")))
        totals=(gb.groupby("pre_nucleus_id",as_index=False)
                .agg(total_n_syn=("branch_n_syn","sum"),total_size=("branch_size","sum"),
                     n_branches=("branch_id","nunique")))
        gb=gb.merge(totals,on="pre_nucleus_id",how="left")
        # Keep only presynaptic cells with functional node records.
        gb=gb[gb.pre_nucleus_id.astype(int).isin(node.index)].copy()
        if gb.pre_nucleus_id.nunique()<MIN_PRE: continue
        # dominant branch per presynaptic partner
        dom=(gb.sort_values(["pre_nucleus_id","branch_n_syn","branch_size"],ascending=[True,False,False])
             .drop_duplicates("pre_nucleus_id")
             [["pre_nucleus_id","branch_id","total_n_syn","total_size","n_branches"]]
             .rename(columns={"branch_id":"dominant_branch"}))
        # all branch sets
        bsets=gb.groupby("pre_nucleus_id")["branch_id"].apply(lambda s: tuple(sorted(set(map(int,s))))).rename("branch_set")
        dom=dom.merge(bsets,on="pre_nucleus_id",how="left")
        dom["post_nucleus_id"]=post_nid
        for r in gb.itertuples(index=False):
            branch_rows.append({"post_nucleus_id":post_nid,"pre_nucleus_id":int(r.pre_nucleus_id),
                                "branch_id":int(r.branch_id),"branch_n_syn":int(r.branch_n_syn),
                                "branch_size":float(r.branch_size),"total_n_syn":int(r.total_n_syn),
                                "total_size":float(r.total_size),"n_branches":int(r.n_branches)})
        cell_rows.append({"post_nucleus_id":post_nid,"post_root_id":post_root,
                          "n_functional_pre_edge":int(cr.n_functional_pre),
                          "n_functional_pre_branchmapped":int(dom.pre_nucleus_id.nunique()),
                          "n_branches_represented":int(gb.branch_id.nunique()),
                          "n_monobranch_pre":int((dom.n_branches==1).sum()),
                          "post_is_functional":bool(post_nid in node.index)})
        analyzed+=1
        os.remove(local)
    except Exception as e:
        fail_rows.append({"post_nucleus_id":post_nid,"post_root_id":post_root,"error":repr(e)})
        try:
            if os.path.exists(local): os.remove(local)
        except Exception: pass

branch_detail=pd.DataFrame(branch_rows)
cell_df=pd.DataFrame(cell_rows)
pd.DataFrame(fail_rows).to_csv(OUT/"meshwork_failures.csv",index=False)
branch_detail.to_csv(OUT/"branch_detail.csv",index=False)
cell_df.to_csv(OUT/"analyzed_posts.csv",index=False)

# Connection table and branch sets
conn=(branch_detail.groupby(["post_nucleus_id","pre_nucleus_id"],as_index=False)
      .agg(total_n_syn=("total_n_syn","first"),total_size=("total_size","first"),
           n_branches=("n_branches","first")))
bsets=(branch_detail.groupby(["post_nucleus_id","pre_nucleus_id"])["branch_id"]
       .apply(lambda s: tuple(sorted(set(map(int,s))))).rename("branch_set").reset_index())
dom=(branch_detail.sort_values(["post_nucleus_id","pre_nucleus_id","branch_n_syn","branch_size"],
                               ascending=[True,True,False,False])
     .drop_duplicates(["post_nucleus_id","pre_nucleus_id"])
     [["post_nucleus_id","pre_nucleus_id","branch_id"]]
     .rename(columns={"branch_id":"dominant_branch"}))
conn=conn.merge(bsets,on=["post_nucleus_id","pre_nucleus_id"]).merge(dom,on=["post_nucleus_id","pre_nucleus_id"])
conn.to_csv(OUT/"connection_branch_map.csv",index=False)

# Q1: functional similarity on same vs different branch.
pair_rows=[]
metrics=["readout_similarity","in_silico_response_similarity","orientation_similarity","in_vivo_response_similarity_same_scan"]
for post,g in conn.groupby("post_nucleus_id"):
    g=g.reset_index(drop=True)
    for i in range(len(g)):
        a=g.iloc[i]; na=node.loc[int(a.pre_nucleus_id)]
        for j in range(i+1,len(g)):
            b=g.iloc[j]; nb=node.loc[int(b.pre_nucleus_id)]
            same_dom=int(a.dominant_branch)==int(b.dominant_branch)
            same_any=bool(set(a.branch_set).intersection(set(b.branch_set)))
            real=np.nan
            same_scan=(pd.notna(na.scan_session) and pd.notna(nb.scan_session) and
                       float(na.scan_session)==float(nb.scan_session) and
                       float(na.scan_idx)==float(nb.scan_idx))
            if same_scan: real=corr(na.in_vivo_mean_resp,nb.in_vivo_mean_resp)
            pair_rows.append({
                "post_nucleus_id":int(post),"pre_i":int(a.pre_nucleus_id),"pre_j":int(b.pre_nucleus_id),
                "same_dominant_branch":same_dom,"share_any_branch":same_any,
                "readout_similarity":cosine(na.readout_cvt,nb.readout_cvt),
                "in_silico_response_similarity":corr(na.in_silico_resp,nb.in_silico_resp),
                "orientation_similarity":circ_ori_sim(na.pref_ori_cvt_monet_full,nb.pref_ori_cvt_monet_full),
                "in_vivo_response_similarity_same_scan":real,
            })
pairs=pd.DataFrame(pair_rows)
pairs.to_csv(OUT/"q1_pair_table.csv",index=False)

q1_summary=[]
q1_cell_effects=[]
for metric in metrics:
    cell_eff=[]
    for post,g in pairs.groupby("post_nucleus_id"):
        s=g.loc[g.same_dominant_branch,metric].dropna()
        d=g.loc[~g.same_dominant_branch,metric].dropna()
        if len(s)>0 and len(d)>0:
            delta=float(s.mean()-d.mean()); cell_eff.append(delta)
            q1_cell_effects.append({"metric":metric,"post_nucleus_id":int(post),
                                    "same_mean":float(s.mean()),"different_mean":float(d.mean()),
                                    "delta":delta,"n_same_pairs":len(s),"n_diff_pairs":len(d)})
    obs,lo,hi=mean_ci(cell_eff)
    # geometry-preserving within-cell label permutation
    null=[]
    usable_posts=[p for p,g in conn.groupby("post_nucleus_id") if len(g)>=3]
    for rep in range(N_PERM):
        rep_eff=[]
        for post,gc in conn.groupby("post_nucleus_id"):
            gc=gc.reset_index(drop=True)
            if len(gc)<3: continue
            # precompute original functional values and permute identities
            perm=RNG.permutation(len(gc))
            vals=[]
            for ii in range(len(gc)):
                ni=node.loc[int(gc.iloc[perm[ii]].pre_nucleus_id)]
                vals.append(ni)
            ss=[]; dd=[]
            for i in range(len(gc)):
                for j in range(i+1,len(gc)):
                    ni=vals[i]; nj=vals[j]
                    if metric=="readout_similarity": v=cosine(ni.readout_cvt,nj.readout_cvt)
                    elif metric=="in_silico_response_similarity": v=corr(ni.in_silico_resp,nj.in_silico_resp)
                    elif metric=="orientation_similarity": v=circ_ori_sim(ni.pref_ori_cvt_monet_full,nj.pref_ori_cvt_monet_full)
                    else:
                        same_scan=(pd.notna(ni.scan_session) and pd.notna(nj.scan_session) and
                                   float(ni.scan_session)==float(nj.scan_session) and float(ni.scan_idx)==float(nj.scan_idx))
                        v=corr(ni.in_vivo_mean_resp,nj.in_vivo_mean_resp) if same_scan else np.nan
                    if not np.isfinite(v): continue
                    same=int(gc.iloc[i].dominant_branch)==int(gc.iloc[j].dominant_branch)
                    (ss if same else dd).append(v)
            if ss and dd: rep_eff.append(float(np.mean(ss)-np.mean(dd)))
        null.append(float(np.mean(rep_eff)) if rep_eff else np.nan)
    q1_summary.append({"metric":metric,"n_posts":len(cell_eff),"mean_delta":obs,
                       "bootstrap_ci_low":lo,"bootstrap_ci_high":hi,
                       "permutation_p_greater":perm_p(obs,null,True),
                       "median_delta":float(np.nanmedian(cell_eff)) if cell_eff else np.nan,
                       "fraction_positive":float(np.mean(np.asarray(cell_eff)>0)) if cell_eff else np.nan})
pd.DataFrame(q1_cell_effects).to_csv(OUT/"q1_cell_effects.csv",index=False)
pd.DataFrame(q1_summary).to_csv(OUT/"q1_summary.csv",index=False)

# Q2 helpers
def response_matrix(pre_ids,post_id,col,require_same_scan=False):
    if post_id not in node.index: return None
    post=node.loc[post_id]; y=arr(post[col])
    if y is None: return None
    kept=[]; xs=[]
    for pid in pre_ids:
        if pid not in node.index: continue
        pr=node.loc[pid]
        if require_same_scan:
            if pd.isna(post.scan_session) or pd.isna(pr.scan_session): continue
            if float(post.scan_session)!=float(pr.scan_session) or float(post.scan_idx)!=float(pr.scan_idx): continue
        x=arr(pr[col])
        if x is None or x.shape!=y.shape: continue
        kept.append(pid); xs.append(x)
    if len(kept)<MIN_PRE: return None
    X=np.column_stack(xs)
    m=np.isfinite(y)&np.all(np.isfinite(X),axis=1)
    if m.sum()<20: return None
    return X[m],y[m],kept

def make_W(post,pre_ids,weight_col):
    d=branch_detail[(branch_detail.post_nucleus_id==post)&branch_detail.pre_nucleus_id.isin(pre_ids)].copy()
    branches=sorted(d.branch_id.unique().astype(int))
    if len(branches)<2:return None
    pi={p:i for i,p in enumerate(pre_ids)}; bi={b:i for i,b in enumerate(branches)}
    W=np.zeros((len(pre_ids),len(branches)),float)
    source="branch_n_syn" if weight_col=="count" else "branch_size"
    for r in d.itertuples(index=False):
        W[pi[int(r.pre_nucleus_id)],bi[int(r.branch_id)]]+=float(getattr(r,source))
    if W.sum()<=0:return None
    W=W/W.sum(); wt=W.sum(1)
    prof=np.zeros_like(W); nz=wt>0; prof[nz]=W[nz]/wt[nz,None]
    return W,wt,prof,branches

def cv_models(X,y,W,wt,prof):
    A=np.maximum(X,0)
    G=A@wt; G2=G*G
    B=A@W; Q=np.sum(B*B,axis=1)
    k=min(5,max(2,len(y)//20))
    cv=KFold(n_splits=k,shuffle=True,random_state=20261113)
    splits=list(cv.split(y))
    def score(F):
        pred=np.full(len(y),np.nan)
        for tr,te in splits:
            model=RidgeCV(alphas=np.logspace(-4,4,25))
            model.fit(F[tr],y[tr]); pred[te]=model.predict(F[te])
        return float(r2_score(y,pred)), float(np.corrcoef(y,pred)[0,1]) if np.std(pred)>0 and np.std(y)>0 else np.nan
    rG=score(np.column_stack([G,G2]))
    rT=score(np.column_stack([G,G2,Q]))
    sh=[]
    for _ in range(N_SHUFFLE):
        order=RNG.permutation(len(prof))
        Ws=wt[:,None]*prof[order,:]
        Bs=A@Ws; Qs=np.sum(Bs*Bs,axis=1)
        sh.append(score(np.column_stack([G,G2,Qs]))[0])
    return rG,rT,np.asarray(sh,float)

q2_rows=[]
for col,label,real_only in [
    ("in_silico_resp","digital_twin_natural_movie",False),
    ("in_vivo_mean_resp","in_vivo_natural_movie_same_scan",True),
]:
    for post,g in conn.groupby("post_nucleus_id"):
        post=int(post)
        pre_ids=sorted(set(g.pre_nucleus_id.astype(int)))
        rm=response_matrix(pre_ids,post,col,require_same_scan=real_only)
        if rm is None: continue
        X,y,kept=rm
        for scheme in ["count","size"]:
            ww=make_W(post,kept,scheme)
            if ww is None: continue
            W,wt,prof,branches=ww
            rG,rT,sh=cv_models(X,y,W,wt,prof)
            q2_rows.append({"target":label,"post_nucleus_id":post,"weight_scheme":scheme,
                            "n_pre_inputs":len(kept),"n_branches":len(branches),"n_stimulus_samples":len(y),
                            "graph_global_r2":rG[0],"graph_global_corr":rG[1],
                            "true_dendrite_r2":rT[0],"true_dendrite_corr":rT[1],
                            "shuffled_mean_r2":float(np.nanmean(sh)),"shuffled_median_r2":float(np.nanmedian(sh)),
                            "shuffled_p_ge_true":float((1+np.sum(sh>=rT[0]))/(1+len(sh))),
                            "delta_true_vs_graph_r2":float(rT[0]-rG[0]),
                            "delta_true_vs_shuffled_r2":float(rT[0]-np.nanmean(sh))})
q2=pd.DataFrame(q2_rows)
q2.to_csv(OUT/"q2_per_cell.csv",index=False)

q2_summary=[]
if len(q2):
    for (target,scheme),g in q2.groupby(["target","weight_scheme"]):
        dg=g.delta_true_vs_graph_r2.to_numpy(float)
        ds=g.delta_true_vs_shuffled_r2.to_numpy(float)
        mg,lg,hg=mean_ci(dg); ms,ls,hs=mean_ci(ds)
        # one-sided sign-flip permutation across postsynaptic cells
        def sf(v):
            v=v[np.isfinite(v)]
            if len(v)==0:return np.nan
            obs=np.mean(v); null=[]
            for _ in range(10000): null.append(np.mean(v*RNG.choice([-1,1],size=len(v))))
            return perm_p(obs,null,True)
        q2_summary.append({"target":target,"weight_scheme":scheme,"n_posts":len(g),
                           "mean_true_r2":float(g.true_dendrite_r2.mean()),
                           "mean_graph_r2":float(g.graph_global_r2.mean()),
                           "mean_shuffled_r2":float(g.shuffled_mean_r2.mean()),
                           "mean_delta_true_vs_graph_r2":mg,"delta_graph_ci_low":lg,"delta_graph_ci_high":hg,
                           "signflip_p_true_vs_graph":sf(dg),
                           "mean_delta_true_vs_shuffled_r2":ms,"delta_shuffle_ci_low":ls,"delta_shuffle_ci_high":hs,
                           "signflip_p_true_vs_shuffled":sf(ds),
                           "fraction_posts_true_gt_graph":float(np.mean(dg>0)),
                           "fraction_posts_true_gt_shuffled":float(np.mean(ds>0))})
pd.DataFrame(q2_summary).to_csv(OUT/"q2_summary.csv",index=False)

summary={
    "functional_nodes":int(len(node)),
    "connected_edges":int(len(connected)),
    "candidate_posts_min3_functional_pre":int(len(cand)),
    "candidate_posts_checked_until_limit":int(available_checked),
    "posts_branch_analyzed":int(analyzed),
    "posts_functional_among_analyzed":int(cell_df.post_is_functional.sum()) if len(cell_df) else 0,
    "q1":q1_summary,
    "q2":q2_summary,
    "claim_limit":"MICrONS is static; positive results test functional information in dendritic placement, not learning or memory formation."
}
(OUT/"FINAL_SUMMARY.json").write_text(json.dumps(summary,indent=2,default=str))
print(json.dumps(summary,indent=2,default=str))
