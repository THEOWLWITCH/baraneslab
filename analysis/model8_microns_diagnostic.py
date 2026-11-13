import os, json, gzip, io, requests, traceback
from pathlib import Path
import pandas as pd, numpy as np

OUT=Path("model8_microns_results"); OUT.mkdir(exist_ok=True)
BASE="https://s3.amazonaws.com/bossdb-open-data/iarpa_microns/minnie/functional_data/functional_connectomics/node_and_edge_properties/v1"
STATIC="https://storage.googleapis.com/mat_dbs/public/minnie65_phase3_v1/v661"
MESH="https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie/minnie65/skeletons/v661/meshworks"

def get(url,path):
    p=Path(path)
    if not p.exists():
        r=requests.get(url,timeout=180); r.raise_for_status(); p.write_bytes(r.content)
    return p

def load_static(table):
    h=requests.get(f"{STATIC}/{table}_merged_header.csv",timeout=120); h.raise_for_status()
    d=requests.get(f"{STATIC}/{table}_merged.csv.gz",timeout=300); d.raise_for_status()
    header=pd.read_csv(io.BytesIO(h.content),header=None,names=["column","type"])
    df=pd.read_csv(io.BytesIO(d.content),compression="gzip",header=None,low_memory=False)
    df.columns=header["column"].tolist()
    return df

lines=[]
try:
    get(f"{BASE}/node_data_v1.pkl","/tmp/node.pkl")
    get(f"{BASE}/edge_data_v1.pkl","/tmp/edge.pkl")
    get(f"{BASE}/readme_v1.md","/tmp/readme.md")
    node=pd.read_pickle("/tmp/node.pkl")
    edge=pd.read_pickle("/tmp/edge.pkl")
    lines += [f"node shape={node.shape}", f"edge shape={edge.shape}",
              "NODE COLUMNS\n"+repr(list(node.columns)),
              "EDGE COLUMNS\n"+repr(list(edge.columns)),
              "NODE DTYPES\n"+node.dtypes.astype(str).to_string(),
              "EDGE DTYPES\n"+edge.dtypes.astype(str).to_string()]
    node.head(20).to_csv(OUT/"node_head.csv",index=False)
    edge.head(20).to_csv(OUT/"edge_head.csv",index=False)
    (OUT/"functional_readme.md").write_text(Path("/tmp/readme.md").read_text(errors="ignore"))

    connected=edge.query("n_synapses > 0").copy() if "n_synapses" in edge.columns else edge.copy()
    lines += [f"connected rows={len(connected)}"]
    for c in ["pre_nucleus_id","post_nucleus_id"]:
        if c in connected.columns: lines.append(f"{c} unique={connected[c].nunique()}")

    nuc=load_static("nucleus_detection_v0")
    lines += ["NUCLEUS COLUMNS\n"+repr(list(nuc.columns)), f"nucleus shape={nuc.shape}"]
    nuc.head(20).to_csv(OUT/"nucleus_head.csv",index=False)

    if "post_nucleus_id" in connected.columns:
        counts=(connected.groupby("post_nucleus_id")
                .agg(n_pre=("pre_nucleus_id","nunique"), n_syn=("n_synapses","sum"))
                .sort_values(["n_pre","n_syn"],ascending=False).reset_index())
        counts.to_csv(OUT/"post_candidate_counts.csv",index=False)
        nidcol="id" if "id" in nuc.columns else ("nucleus_id" if "nucleus_id" in nuc.columns else None)
        rootcol="pt_root_id" if "pt_root_id" in nuc.columns else None
        lines += [f"nucleus id col={nidcol}, root col={rootcol}"]
        if nidcol and rootcol:
            m=counts.merge(nuc[[nidcol,rootcol]].rename(columns={nidcol:"post_nucleus_id"}),on="post_nucleus_id",how="left")
            m.to_csv(OUT/"post_candidate_mapping.csv",index=False)
            # Try top 20 mapped cells for public static meshwork availability.
            avail=[]
            for r in m.dropna(subset=[rootcol]).head(50).itertuples(index=False):
                nid=int(getattr(r,"post_nucleus_id")); rid=int(getattr(r,rootcol))
                url=f"{MESH}/{rid}_{nid}.h5"
                try:
                    rr=requests.head(url,timeout=30,allow_redirects=True)
                    ok=rr.status_code==200
                except Exception:
                    ok=False
                avail.append({"nucleus_id":nid,"root_id":rid,"meshwork_available":ok,"url":url})
                if ok:
                    # download first available and introspect
                    local="/tmp/sample.h5"
                    get(url,local)
                    try:
                        from meshparty import meshwork
                        mw=meshwork.load_meshwork(local)
                        info={
                            "root_id":rid,"nucleus_id":nid,
                            "anno_dir":[x for x in dir(mw.anno) if not x.startswith("_")],
                            "skeleton_dir":[x for x in dir(mw.skeleton) if not x.startswith("_")][:200],
                            "n_vertices":len(mw.skeleton.vertices),
                            "n_segments":len(mw.skeleton.segments),
                        }
                        # inspect annotation tables
                        for nm in ["post_syn","pre_syn","is_axon","is_apical"]:
                            if hasattr(mw.anno,nm):
                                a=getattr(mw.anno,nm)
                                try: info[nm+"_columns"]=list(a.df.columns)
                                except Exception: pass
                                try: info[nm+"_n"]=len(a.df)
                                except Exception: pass
                        (OUT/"sample_meshwork_info.json").write_text(json.dumps(info,indent=2,default=str))
                    except Exception as e:
                        (OUT/"sample_meshwork_error.txt").write_text(traceback.format_exc())
                    break
            pd.DataFrame(avail).to_csv(OUT/"meshwork_availability.csv",index=False)
except Exception:
    lines.append("FATAL\n"+traceback.format_exc())

(OUT/"diagnostic.txt").write_text("\n\n".join(lines))
print("\n".join(lines[-10:]))
