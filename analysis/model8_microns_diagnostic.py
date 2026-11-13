import io, gzip, json, os, sys, tempfile, requests
import numpy as np
import pandas as pd

OUT='model8_microns_results'
os.makedirs(OUT, exist_ok=True)

def get(url):
    r=requests.get(url, timeout=120)
    r.raise_for_status()
    return r.content

def static_table(name, version=661):
    base=f"https://storage.googleapis.com/mat_dbs/public/minnie65_phase3_v1/v{version}"
    h=get(f"{base}/{name}_merged_header.csv")
    header=pd.read_csv(io.BytesIO(h), header=None, names=['column','type'])
    d=get(f"{base}/{name}_merged.csv.gz")
    df=pd.read_csv(io.BytesIO(d), compression='gzip', header=None)
    df.columns=header['column'].tolist()
    return df

log=[]
for name in ['coregistration_manual_v3','nucleus_detection_lookup_v1','proofreading_status_public_release','allen_v1_column_types_slanted_ref']:
    try:
        df=static_table(name)
        log.append({'table':name,'n':len(df),'columns':'|'.join(df.columns)})
        df.head(3).to_csv(f"{OUT}/{name}_head.csv",index=False)
    except Exception as e:
        log.append({'table':name,'error':repr(e)})

# Functional release files
base='https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/functional_data/digital_twin_properties/v2'
for rel in ['readout/units.csv','performance/units.csv','ori_dir_tuning/units.csv']:
    try:
        data=get(f"{base}/{rel}")
        df=pd.read_csv(io.BytesIO(data))
        log.append({'table':rel,'n':len(df),'columns':'|'.join(df.columns)})
        df.head(3).to_csv(f"{OUT}/{rel.replace('/','_')}_head.csv",index=False)
    except Exception as e:
        log.append({'table':rel,'error':repr(e)})

# Known public meshwork from MICrONS tutorial
mesh_url='https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/skeletons/v661/meshworks/864691135122603047_292685.h5'
mesh_path=f"{OUT}/example.h5"
try:
    data=get(mesh_url)
    open(mesh_path,'wb').write(data)
    log.append({'table':'example_meshwork_download','bytes':len(data)})
    from meshparty import meshwork
    mw=meshwork.load_meshwork(mesh_path)
    log.append({'table':'example_meshwork','seg_id':str(mw.seg_id),'n_skel_vertices':len(mw.skeleton.vertices),'annos':'|'.join(mw.anno.table_names)})
    for n in mw.anno.table_names:
        a=mw.anno[n]
        log.append({'table':f'anno:{n}','n':len(a.df),'columns':'|'.join(map(str,a.df.columns))})
        a.df.head(3).to_csv(f"{OUT}/anno_{n}_head.csv",index=False)
    os.remove(mesh_path)
except Exception as e:
    import traceback
    log.append({'table':'example_meshwork','error':repr(e),'traceback':traceback.format_exc()})

pd.DataFrame(log).to_csv(f"{OUT}/diagnostic.csv",index=False)
print(pd.DataFrame(log).to_string())
