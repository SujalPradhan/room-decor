"""Local experiment, not a hosted inference service. Public TripoSR weights; no API key."""
import os,sys,time,json,types,argparse,pathlib,subprocess
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK','1')
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN']='1'
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--source',default='.local-3d/TripoSR');p.add_argument('--device',choices=['mps','cpu'],default='mps');p.add_argument('--resolution',type=int,default=256);args=p.parse_args()
root=pathlib.Path(args.output);root.mkdir(parents=True,exist_ok=True)
start=time.monotonic();stages=[]
def stage(name,t):
 elapsed=time.monotonic()-t;stages.append({'stage':name,'seconds':round(elapsed,3)});print(name,round(elapsed,2),'s',flush=True)
import torch,numpy as np
from PIL import Image
from skimage.measure import marching_cubes
# CPU marching-cubes compatibility shim: skimage indices are x/y/z in this
# field. Upstream torchmcubes is returned in z/y/x order then reversed by TSR.
shim=types.ModuleType('torchmcubes')
def mc(level,threshold):
 v,f,_,_=marching_cubes(level.detach().cpu().numpy(),level=threshold)
 return torch.from_numpy(v[:,[2,1,0]].copy()),torch.from_numpy(f[:,[0,2,1]].copy())
shim.marching_cubes=mc;sys.modules['torchmcubes']=shim
sys.path.insert(0,str(pathlib.Path(args.source).resolve()))
from tsr.system import TSR
from tsr.utils import resize_foreground
import rembg
print('Device',args.device,'MPS available',torch.backends.mps.is_available(),flush=True)
t=time.monotonic();image=Image.open(args.input).convert('RGB');image.thumbnail((1024,1024));session=rembg.new_session('u2netp',providers=['CPUExecutionProvider']);cut=rembg.remove(image,session=session);cut.save(root/'segmented.png');processed=resize_foreground(cut,.85);processed.save(root/'input.png');rgba=np.array(processed).astype(np.float32)/255;image=Image.fromarray((255*(rgba[:,:,:3]*rgba[:,:,3:]+.5*(1-rgba[:,:,3:]))).astype(np.uint8));stage('image-preparation',t)
t=time.monotonic();model=TSR.from_pretrained('stabilityai/TripoSR',config_name='config.yaml',weight_name='model.ckpt');model.renderer.set_chunk_size(8192);model=model.to(args.device).eval();stage('load-model-and-weights',t)
with torch.no_grad():
 t=time.monotonic();scene=model([image],device=args.device)
 if args.device=='mps':torch.mps.synchronize()
 stage('image-to-3d-inference',t)
 t=time.monotonic();mesh=model.extract_mesh(scene,has_vertex_color=True,resolution=args.resolution)[0]
 if args.device=='mps':torch.mps.synchronize()
 mesh.remove_unreferenced_vertices();mesh.fix_normals();mesh.export(root/'recliner-raw.glb');stage('mesh-extraction-and-export',t)
report={'provider':'local','model':'stabilityai/TripoSR','device':args.device,'resolution':args.resolution,'sourceCommit':subprocess.check_output(['git','-C',args.source,'rev-parse','HEAD'],text=True).strip(),'stages':stages,'elapsedSeconds':round(time.monotonic()-start,3),'vertices':len(mesh.vertices),'faces':len(mesh.faces),'bounds':mesh.bounds.tolist(),'providerCharge':0,'billingNote':'No external inference call; downloads and local compute are unmetered.','limitations':['Single input image; unseen surfaces are inferred.','CPU scikit-image marching cubes compatibility shim.','Metric scaling and orientation require separate validation.']}
(root/'generation-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
