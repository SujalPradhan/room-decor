"""Convert an inferred colored mesh into a grounded metric, textured GLB.
Dimensions are listing evidence, not measured truth. No manual geometry is authored.
"""
import bpy,sys,json,math,time,pathlib
import numpy as np
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];root=pathlib.Path(args[0]).resolve();start=time.monotonic()
product=json.loads((root/'product.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root/'recliner-raw.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert meshes,'No generated geometry'
for o in bpy.context.selected_objects:o.select_set(False)
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();obj=bpy.context.object
obj.rotation_mode='XYZ'
# Raw TSR coordinates are x-back, y-right, z-up. The raw GLB retains
# those numeric coordinates; undo the glTF import axis mapping, then rotate
# the horizontal axes so the chair front faces Blender -Y (glTF +Z).
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
obj.rotation_euler=(-math.pi/2,0,0)
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
points=np.array([tuple(v.co) for v in obj.data.vertices])
z=points[:,2];top=points[z>np.quantile(z,.8),:2].mean(axis=0);seat=points[(z>np.quantile(z,.2))&(z<np.quantile(z,.65)),:2].mean(axis=0)
back=top-seat;heading=math.pi/2-math.atan2(float(back[1]),float(back[0])) if product.get('kind')=='chair' and np.linalg.norm(back)>.05 else -math.pi/2
obj.rotation_euler=(0,0,heading)
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
raw_size=list(obj.dimensions)
axes=['width','depth','height'];known=[product['dimensions'][a]['metres'] for a in axes]
ratios=[v/max(float(d),1e-6) for v,d in zip(known,raw_size) if isinstance(v,(int,float)) and math.isfinite(v) and v>0]
uniform=float(np.median(ratios)) if ratios else 1.0/max(raw_size)
limits=[(.05,20),(.05,20),(.02,10)]
want=[v if isinstance(v,(int,float)) and math.isfinite(v) and v>0 else min(hi,max(lo,float(d)*uniform)) for v,d,(lo,hi) in zip(known,raw_size,limits)]
estimated=any(v is None for v in known)
product['model']={**product['model'],'placementDimensions':dict(zip(axes,want)),'scaleSource':'estimated' if estimated else 'listing'}
if estimated:product['specificationWarnings']=list(dict.fromkeys([*product.get('specificationWarnings',[]),'Some outer measurements are unavailable. Display scale is estimated from inferred geometry; fit is unverified.']))
(root/'product.json').write_text(json.dumps(product,indent=2))
obj.scale=[v/max(float(d),1e-6) for v,d in zip(want,obj.dimensions)];bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
bounds=[obj.matrix_world@Vector(c) for c in obj.bound_box];minimum=Vector([min(v[a] for v in bounds) for a in range(3)]);maximum=Vector([max(v[a] for v in bounds) for a in range(3)])
obj.location-=Vector(((minimum.x+maximum.x)/2,(minimum.y+maximum.y)/2,minimum.z));bpy.ops.object.transform_apply(location=True,rotation=False,scale=False)
# Bake the generated colors into an embedded texture, preserving the inferred
# appearance. Do not recolor or replace the model with catalog geometry.
if len(obj.data.polygons)>70000:
 mod=obj.modifiers.new('Mobile mesh budget','DECIMATE');mod.ratio=70000/len(obj.data.polygons);bpy.ops.object.modifier_apply(modifier=mod.name)
for poly in obj.data.polygons:poly.use_smooth=True
colors=obj.data.color_attributes;assert len(colors),'Generated mesh has no color data'
# TripoSR predicts display/sRGB colors; glTF vertex colors are linear. Convert
# once before baking, rather than brighten the brown upholstery accidentally.
for attribute in colors:
 rgba=np.empty((len(attribute.data),4),dtype=np.float32);attribute.data.foreach_get('color',rgba.ravel())
 c=rgba[:,:3];rgba[:,:3]=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4);attribute.data.foreach_set('color',rgba.ravel())
color_name=colors[0].name
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.015);bpy.ops.object.mode_set(mode='OBJECT')
image=bpy.data.images.new('Inferred recliner appearance',width=1024,height=1024,alpha=False)
mat=bpy.data.materials.new('Inferred velvet appearance');mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear()
out=nodes.new('ShaderNodeOutputMaterial');emit=nodes.new('ShaderNodeEmission');attribute=nodes.new('ShaderNodeVertexColor');attribute.layer_name=color_name
mat.node_tree.links.new(attribute.outputs['Color'],emit.inputs['Color']);mat.node_tree.links.new(emit.outputs[0],out.inputs['Surface']);texture=nodes.new('ShaderNodeTexImage');texture.image=image;nodes.active=texture
obj.data.materials.clear();obj.data.materials.append(mat)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.render.bake.margin=4
bpy.ops.object.bake(type='EMIT')
principled=nodes.new('ShaderNodeBsdfPrincipled');principled.inputs['Roughness'].default_value=.83;mat.node_tree.links.new(texture.outputs['Color'],principled.inputs['Base Color']);mat.node_tree.links.new(principled.outputs['BSDF'],out.inputs['Surface']);image.pack()
stretch=max(w/d for w,d in zip(want,raw_size))/min(w/d for w,d in zip(want,raw_size))
warnings=['Listing-axis scaling changes inferred proportions substantially; verify appearance and fit.'] if stretch>1.2 else []
obj['roomshift_inference']=json.dumps({'model':'stabilityai/TripoSR','source':product['source'],'listingDimensionsMetres':dict(zip(['width','depth','height'],want)),'geometryWarnings':warnings,'hiddenGeometry':'inferred, not measured'})
model=root/'snuzspace-recliner-experimental.glb';bpy.ops.export_scene.gltf(filepath=str(model),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True)
(root/'conversion-report.json').write_text(json.dumps({'rawOrientedBoundsMetres':raw_size,'targetListingDimensionsMetres':dict(zip(['width','depth','height'],want)),'blenderDimensionsMetres':list(obj.dimensions),'axisScalingRatio':stretch,'geometryWarnings':warnings,'faces':len(obj.data.polygons),'textureSize':1024,'colorSpace':'TripoSR sRGB converted to linear vertex colors before texture baking','fileBytes':model.stat().st_size,'conversionSeconds':time.monotonic()-start,'orientation':'TSR Z-up corrected; chair front estimated from upper-back versus seat centroids; visual validation required','inferredYawDegrees':math.degrees(heading),'scaleSource':'estimated' if estimated else 'listing','note':'Known sizes follow retailer evidence; missing sizes use an estimated display scale. Hidden surfaces and colors are inferred.'},indent=2))
# Save a reproducible turntable view, separate from the exported product asset.
obj.select_set(False)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.008));plane=bpy.context.object;floor=bpy.data.materials.new('Preview floor');floor.diffuse_color=(.52,.55,.49,1);plane.data.materials.append(floor)
scene.world.color=(.3,.3,.3)
for name,location,power,size in [('Key',(2,-3,4),450,3),('Fill',(-2,-1,3),250,3),('Rim',(0,3,4),400,2)]:
 bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.name=name;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,.55))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(1.7,-2.3,1.45));camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=1.8;camera.rotation_euler=(Vector((0,0,.55))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(root/'model-preview.png');bpy.ops.wm.save_as_mainfile(filepath=str(root/'recliner-preview.blend'));bpy.ops.render.render(write_still=True)
