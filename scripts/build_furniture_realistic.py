"""Original photo-informed furniture library, authored in Blender 4.5 LTS.

Rebuild: uv run --python 3.11 --with bpy==4.5.15 python scripts/build_furniture_realistic.py
All patterns are authored mathematical textures; no source photographs embedded.
"""
from __future__ import annotations
import argparse
import json
import math
import os
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix, Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/assets"
THUMBS = ASSETS / "thumbnails"
OUT = ASSETS / "furniture-realistic.glb"
ARGS = argparse.ArgumentParser()
ARGS.add_argument("--skip-thumbnails", action="store_true")
options = ARGS.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for collection in (bpy.data.materials, bpy.data.images):
    for block in list(collection):
        collection.remove(block)


def srgb(hex_color):
    return np.array([int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)])


def linear(color):
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in color)


def image(name, array, color=True):
    if array.ndim == 2:
        array = np.repeat(array[:, :, None], 3, axis=2)
    h, w = array.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(array[:, :, :3], 0, 1)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.colorspace_settings.name = "sRGB" if color else "Non-Color"
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def texture_set(name, style, color, size=256):
    """Small tiled original PBR maps, shared by surfaces throughout the library."""
    if style in ("bedding", "red-pattern"):
        size = 512
    y, x = np.mgrid[0:size, 0:size] / size
    rng = np.random.default_rng(sum(map(ord, name)))
    noise = rng.random((size, size)) - .5
    base = srgb(color)
    if style == "wood":
        warp = .003*np.sin(y*math.tau*2) + .001*np.sin(y*math.tau*7+x*math.tau)
        grain = np.sin((x+warp)*math.tau*37) + .4*np.sin((x+warp)*math.tau*73)
        height = .5 + .06*grain + .015*noise
        albedo = base[None,None,:] * (1 + grain[:,:,None]*.020 + noise[:,:,None]*.018)
        roughness = .48 + .025*grain + .025*noise
    elif style == "fabric":
        weave = np.sin(x*math.tau*93) * np.sin(y*math.tau*101)
        height = .5 + .035*weave + .015*noise
        albedo = base[None,None,:] * (1 + weave[:,:,None]*.012 + noise[:,:,None]*.020)
        roughness = np.full_like(x, .91) + .025*noise
    elif style in ("bedding", "red-pattern"):
        weave = np.sin(x*math.tau*139) * np.sin(y*math.tau*151)
        albedo = np.ones((size,size,3)) * base
        if style == "bedding":
            # Broad ivory/brown panels and small woven floral medallions.
            gx, gy = (x*3)%1, (y*4)%1
            borders = (gx < .055)|(gx > .945)|(gy < .045)|(gy > .955)
            inner = (gx>.13)&(gx<.87)&(gy>.12)&(gy<.88)
            checker = ((np.floor(x*3)+np.floor(y*4))%2)==0
            albedo[borders] = srgb("#e6dece")
            albedo[inner & checker] = srgb("#6c5449")
            albedo[inner & ~checker] = srgb("#d7c8b4")
            dx,dy=gx-.5,gy-.5
            theta=np.arctan2(dy,dx);radius=np.sqrt(dx*dx+dy*dy)
            petals=(radius<(.14+.065*np.cos(theta*6))) & checker
            albedo[petals] = srgb("#ede4d3")
        else:
            border=(x<.07)|(x>.93)|(y<.04)|(y>.96)
            albedo[border] = srgb("#e2cbb4")
            inset=(x<.045)|(x>.955)|(y<.026)|(y>.974)
            albedo[inset] = srgb("#794044")
            gx,gy=(x*4)%1,(y*7)%1
            dx,dy=gx-.5,gy-.5;theta=np.arctan2(dy,dx);radius=np.sqrt(dx*dx+dy*dy)
            petals=radius<(.12+.055*np.cos(theta*6))
            albedo[petals & ~border] = srgb("#d4b9a6")
            cx,cy=(x-.5)*1.6,(y-.5);r=np.sqrt(cx*cx+cy*cy);a=np.arctan2(cy,cx)
            medallion=(np.abs(r-(.23+.025*np.cos(12*a)))<.012)
            albedo[medallion] = srgb("#e2cbb4")
        albedo *= 1 + weave[:,:,None]*.035 + noise[:,:,None]*.027
        height = .5 + .14*weave + .04*noise
        roughness=np.full_like(x,.9)+.03*noise
    else:
        height=.5+.03*noise
        albedo=base[None,None,:]*(1+noise[:,:,None]*.02)
        roughness=np.full_like(x,.63)+.045*noise
    dzdy,dzdx=np.gradient(height)
    normal=np.dstack([-dzdx*3,-dzdy*3,np.ones_like(height)])
    normal /= np.linalg.norm(normal,axis=2,keepdims=True)
    return (image(name+" BaseColor",albedo),image(name+" Roughness",roughness,False),image(name+" Normal",normal*.5+.5,False))


MAPS={}
def material(name,color,surface="paint",rough=.65,metal=0,primary=False,pattern=None):
    m=bpy.data.materials.new(name)
    m.use_nodes=True;m["surface"]=surface;m["editableColor"]=primary;m["defaultColor"]=color
    nodes,links=m.node_tree.nodes,m.node_tree.links;p=nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value=(*linear(srgb(color)),1)
    p.inputs["Roughness"].default_value=rough;p.inputs["Metallic"].default_value=metal
    if surface in ("wood","fabric") or pattern:
        key=(pattern or surface,color)
        if key not in MAPS:MAPS[key]=texture_set(name,pattern or surface,color)
        albedo,roughness,normal=MAPS[key]
        for img,socket in ((albedo,"Base Color"),(roughness,"Roughness")):
            tex=nodes.new("ShaderNodeTexImage");tex.image=img;links.new(tex.outputs["Color"],p.inputs[socket])
        tex=nodes.new("ShaderNodeTexImage");tex.image=normal
        bump=nodes.new("ShaderNodeNormalMap");bump.inputs["Strength"].default_value=.10 if surface=="fabric" else .18
        links.new(tex.outputs["Color"],bump.inputs["Color"]);links.new(bump.outputs["Normal"],p.inputs["Normal"])
    return m


WOOD=material("WOOD_Walnut","#73513b","wood")
OAK=material("WOOD_Oak","#ad8b62","wood")
DARKWOOD=material("WOOD_DarkWalnut","#4a362b","wood")
DARK=material("PAINT_MetalDark","#303731",rough=.34,metal=.35)
STEEL=material("METAL_Steel","#b9beb8","metal",rough=.27,metal=.8)
BRASS=material("METAL_Brass","#b5a076","metal",rough=.3,metal=.78)
IVORY=material("FABRIC_Ivory","#e1d9c8","fabric")
PINK=material("FABRIC_Pink","#c79ca2","fabric")
BLUE=material("FABRIC_Blue","#557e98","fabric")
SAGE=material("FABRIC_Sage","#7e8c78","fabric")
TERRACOTTA=material("PAINT_Terracotta","#aa7458",rough=.86)
SOIL=material("PAINT_Soil","#3f3024",rough=.98)
GREEN=material("PAINT_LeafGreen","#41633b",rough=.65)
GREENLIGHT=material("PAINT_LeafLight","#678250",rough=.68)
CURRENT=None
ROOTS=[]


def adopt(o,name,mat):
    o.name=name;o.parent=CURRENT
    o.data.materials.append(mat);o["surface"]=mat.get("surface","paint")
    o["asset_kind"]=CURRENT.name;o["recolorable"]=mat.get("editableColor",False)
    return o


def smooth(o):
    for p in o.data.polygons:p.use_smooth=True
    return o


def box(name,loc,size,mat,bevel=.008,segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=adopt(bpy.context.object,name,mat);o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new("Rounded joinery","BEVEL");b.width=min(bevel,min(size)*.4);b.segments=segments
        bpy.ops.object.modifier_apply(modifier=b.name)
        smooth(o);n=o.modifiers.new("Weighted normals","WEIGHTED_NORMAL");bpy.ops.object.modifier_apply(modifier=n.name)
    # Cube projection supplies useful grain scale on the visible sides.
    bpy.context.view_layer.objects.active=o
    bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=max(size));bpy.ops.object.mode_set(mode="OBJECT")
    return o


def sphere(name,loc,size,mat,segments=24,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=.5,location=loc)
    o=adopt(bpy.context.object,name,mat);o.scale=size;return smooth(o)


def cylinder(name,loc,radius,height,mat,vertices=32,rotation=None,radius_top=None):
    if radius_top is None:bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=height,location=loc)
    else:bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius_top,depth=height,location=loc)
    o=adopt(bpy.context.object,name,mat)
    if rotation:o.rotation_euler=rotation
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o


def rod(name,a,b,radius,mat,vertices=10):
    a,b=Vector(a),Vector(b);o=cylinder(name,(a+b)/2,radius,(b-a).length,mat,vertices)
    o.rotation_euler=(b-a).to_track_quat("Z","Y").to_euler();return o


def pipe(name,points,radius,mat,closed=False,resolution=2):
    data=bpy.data.curves.new(name,"CURVE");data.dimensions="3D";data.resolution_u=1
    data.bevel_depth=radius;data.bevel_resolution=resolution
    spline=data.splines.new("POLY");spline.points.add(len(points)-1)
    for p,co in zip(spline.points,points):p.co=(*co,1)
    spline.use_cyclic_u=closed
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.parent=CURRENT;data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT");o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target="MESH")
    o=bpy.context.object;o["surface"]=mat.get("surface","paint");return smooth(o)


def rounded_outline(w,d,z,r=.04):
    points=[]
    for cx,cy,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,math.pi/2),(-w/2+r,-d/2+r,math.pi),(w/2-r,-d/2+r,math.pi*1.5)]:
        for k in range(8):
            a=start+k*math.pi/14;points.append((cx+r*math.cos(a),cy+r*math.sin(a),z))
    return points


def grid_mesh(name,verts,faces,uvs,mat):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);adopt(o,name,mat)
    uv=data.uv_layers.new(name="UVMap")
    for polygon in data.polygons:
        for loop in polygon.loop_indices:uv.data[loop].uv=uvs[data.loops[loop].vertex_index]
    return smooth(o)


def duvet_height(x,y):
    u=x/1.48+.5;v=(y+.13)/1.74+.5
    edge=max(0,(abs(u-.5)-.425)/.075);end=max(0,(.07-v)/.07)
    return .585+.009*(math.sin(x*31+y*4+1)+.45*math.sin(y*38+x*5))-.22*edge*edge-.154*end*end


def cloth(name,center,size,mat,fold=.008,drop=.20,nx=42,ny=52,seed=1,on_duvet=False):
    verts=[];uvs=[];faces=[];cx,cy,cz=center;w,d=size
    for j in range(ny+1):
        v=j/ny;y=(v-.5)*d
        for i in range(nx+1):
            u=i/nx;x=(u-.5)*w
            edge=max(0,(abs(u-.5)-.425)/.075)
            end=max(0,(.07-v)/.07)
            z=cz + fold*(math.sin(x*31+y*4+seed)+.45*math.sin(y*38+x*5)) - drop*edge*edge - drop*.7*end*end
            if on_duvet:
                z=duvet_height(cx+x,cy+y)+.007+fold*.3*(1+math.sin(x*31+y*4+seed))
            # Uneven hems retain a fabric silhouette rather than a perfect box.
            x+=edge*.008*math.sin(y*27+seed)
            verts.append((cx+x,cy+y,z));uvs.append((u,v))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
    return grid_mesh(name,verts,faces,uvs,mat)


def pillow(name,loc,size,mat,angle=0):
    o=sphere(name,loc,size,mat,32,16)
    for v in o.data.vertices:
        x,y,z=v.co
        v.co.x=math.copysign((abs(x)*2)**.65*.5,x)
        v.co.y=math.copysign((abs(y)*2)**.65*.5,y)
        v.co.z+=.022*math.sin(9*x+4*y)*math.sin(7*y)*max(0,1-abs(z)*2)
    o.rotation_euler.z=angle
    seam=[]
    for i in range(80):
        a=math.tau*i/80
        x=math.copysign(abs(math.cos(a))**.5,math.cos(a))*size[0]*.46
        y=math.copysign(abs(math.sin(a))**.5,math.sin(a))*size[1]*.46
        seam.append((loc[0]+x*math.cos(angle)-y*math.sin(angle),loc[1]+x*math.sin(angle)+y*math.cos(angle),loc[2]))
    pipe(name+" stitched piping",seam,.003,mat,True,1)


def curved_board(name,y,w,bottom,shoulder,rise,thickness,mat):
    verts=[];faces=[];uv=[];n=48
    for i in range(n+1):
        x=-w/2+w*i/n;top=shoulder+rise*math.cos(math.pi*x/w)
        verts.extend([(x,y-thickness/2,bottom),(x,y-thickness/2,top),(x,y+thickness/2,bottom),(x,y+thickness/2,top)])
        uv.extend([(i/n,0),(i/n,1),(i/n,0),(i/n,1)])
    for i in range(n):
        a=i*4;b=a+4;faces.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a+1,b+1,b+3,a+3),(a,a+2,b+2,b)])
    faces.extend([(0,1,3,2),(n*4,n*4+2,n*4+3,n*4+1)])
    o=grid_mesh(name,verts,faces,uv,mat)
    bpy.context.view_layer.objects.active=o;b=o.modifiers.new("Timber eased edge","BEVEL");b.width=.008;b.segments=3;bpy.ops.object.modifier_apply(modifier=b.name)
    return o


def group(kind,dimensions,default_color):
    global CURRENT
    CURRENT=bpy.data.objects.new(kind,None);bpy.context.collection.objects.link(CURRENT)
    CURRENT["kind"]=kind;CURRENT["pivot"]="bottom-center";CURRENT["units"]="normalized"
    CURRENT["sourceDimensions"]=json.dumps(dimensions);CURRENT["defaultColor"]=default_color
    CURRENT["authoredWith"]="Blender "+bpy.app.version_string;ROOTS.append(CURRENT)


def bed(kind="bed",style="timber"):
    color="#b4a291" if style=="timber" else "#b7b49e" if style=="platform" else "#c8baa5"
    group(kind,{"width":1.48,"depth":2.1,"height":.95},color)
    main=material("BODY_"+kind,color,"fabric",primary=True,pattern="bedding" if style=="timber" else "fabric")
    timber=WOOD if style=="timber" else DARKWOOD
    for x in [-.64,.64]:
        for y in [-.89,.89]:
            box("Solid timber bed leg",(x,y,.135),(.085,.10,.27),timber,.006)
    base_h=.27 if style=="platform" else .31
    for x in [-.69,.69]:box("Bed side rail",(x,0,base_h),(.07,2.08,.19),main if style=="upholstered" else timber,.008)
    for y in [-.97,.97]:box("Bed end rail",(0,y,base_h),(1.40,.075,.19),timber,.008)
    for y in np.linspace(-.88,.88,9):box("Mattress support slat",(0,float(y),base_h+.02),(1.31,.10,.035),OAK,.003)
    box("Soft upholstered mattress",(0,0,.455),(1.36,1.99,.20),IVORY,.075,5)
    for z in [.38,.52]:pipe("Mattress edge piping",rounded_outline(1.35,1.98,z,.09),.004,IVORY,True,1)
    if style=="timber":
        curved_board("Curved timber headboard",1.008,1.48,.28,.75,.17,.065,timber)
        curved_board("Curved timber footboard",-1.008,1.48,.25,.49,.10,.055,timber)
        for x in [-.71,.71]:
            box("Headboard end post",(x,.995,.48),(.075,.085,.87),timber,.015)
            box("Footboard end post",(x,-.995,.32),(.075,.085,.55),timber,.012)
    elif style=="platform":
        box("Platform floating plinth",(0,0,.16),(1.40,2.05,.16),timber,.015)
        box("Wide walnut headboard",(0,1.005,.57),(1.48,.085,.73),timber,.025)
        for x in np.linspace(-.66,.66,12):box("Headboard timber channel",(float(x),.954,.60),(.006,.007,.57),OAK,.002)
    else:
        head=material("FABRIC_UpholsteredHeadboard","#c4b7a3","fabric")
        box("Padded headboard surround",(0,1.015,.59),(1.48,.13,.86),head,.065,5)
        for x in np.linspace(-.60,.60,6):box("Headboard padded channel",(float(x),.93,.61),(.225,.075,.75),head,.047,5)
        for y in [-.98,.98]:box("Upholstered bed end",(0,float(y),.31),(1.45,.09,.22),head,.035)
    cloth("Draped duvet with irregular folds",(0,-.13,.585),(1.48,1.74),main,.009,.22)
    pmat=PINK if style=="timber" else IVORY
    for x,a in [(-.34,-.045),(.34,.04)]:pillow("Soft pillow",(x,.69,.60),(.61,.43,.16),pmat,a)
    throwmat=BLUE if style=="timber" else SAGE if style=="platform" else material("FABRIC_SlateThrow","#76838d","fabric")
    cloth("Loosely folded throw",(.24,-.58,.622),(.72,.66),throwmat,.010,.002,28,28,3,True)
    pipe("Throw stitched hem",[(x,-.90,duvet_height(x,-.90)+.009)for x in np.linspace(-.11,.59,36)],.0025,throwmat,False,1)


def wardrobe(kind="wardrobe",sliding=False):
    color="#5a5a55" if not sliding else "#a58b6a"
    group(kind,{"width":1.3 if not sliding else 1.6,"depth":.58,"height":2.04},color)
    body=material("BODY_"+kind,color,"paint" if not sliding else "wood",primary=True)
    w=1.30 if not sliding else 1.60
    box("Wardrobe shadow plinth",(0,0,.055),(w-.055,.53,.11),DARK,.008)
    for x in [-w/2+.025,w/2-.025]:box("Wardrobe side panel",(x,0,1.045),(.05,.57,1.99),body,.006)
    for z in [.13,2.015]:box("Wardrobe horizontal panel",(0,0,z),(w,.58,.045),body,.007)
    box("Wardrobe back panel",(0,.265,1.04),(w-.06,.025,1.90),body,.003)
    doors=2 if sliding else 3
    for i in range(doors):
        dw=(w-.025)/doors;x=-w/2+dw*(i+.5)+.0125
        door_mat=body
        if sliding and i==1:door_mat=material("METAL_SmokedMirror","#8f9993","metal",rough=.12,metal=.85)
        box("Sliding door" if sliding else "Wardrobe hinged door",(x,-.292-(.012 if sliding and i==1 else 0),1.055),(dw-.006,.027,1.88),door_mat,.006)
        if not sliding:
            for offset in [-dw*.42,dw*.42]:box("Fine routed door seam",(x+offset,-.309,1.05),(.002,.001,1.77),DARK,.0003)
        hx=x+(dw*.32 if i%2==0 else -dw*.32)
        for z in [.95,1.12]:rod("Wardrobe handle mounting",(hx,-.305,z),(hx,-.329,z),.006,STEEL)
        rod("Wardrobe brushed handle",(hx,-.334,.95),(hx,-.334,1.12),.008,STEEL)
    if sliding:
        for z in [.13,1.99]:box("Sliding door track",(0,-.315,z),(w-.04,.045,.022),STEEL,.003)
    else:
        cylinder("Cupboard round lock",(.085,-.313,.89),.012,.008,BRASS,24,(math.pi/2,0,0))


def desk(kind="desk",oak=False):
    color="#3b6957" if not oak else "#b4936c"
    group(kind,{"width":1.25 if not oak else 1.4,"depth":.62,"height":.76},color)
    top=material("BODY_"+kind,color,"wood" if oak else "paint",rough=.48,primary=True)
    w=1.25 if not oak else 1.4
    for x in [-w/2+.07,w/2-.07]:
        for y in [-.24,.24]:box("Square tubular steel desk leg",(x,y,.36),(.032,.032,.72),DARK,.003)
        box("Steel foot support",(x,0,.025),(.045,.54,.035),DARK,.006)
        box("Desk frame side apron",(x,0,.69),(.028,.50,.055),DARK,.003)
    box("Desk rear crossrail",(0,.24,.68),(w-.12,.025,.06),DARK,.003)
    box("Desk timber edge core",(0,0,.735),(w,.62,.04),OAK if oak else DARKWOOD,.005)
    box("Desk work surface",(0,0,.758),(w-.004,.616,.012),top,.003)
    if oak:
        box("Floating oak drawer",(.33,-.015,.65),(.56,.52,.12),top,.008)
        rod("Drawer recessed pull",(.18,-.282,.65),(.48,-.282,.65),.006,DARK)
        cylinder("Desk cable grommet",(-.45,.21,.766),.026,.003,DARK,32)


def chair(kind="chair",task=False):
    color="#48534a" if not task else "#8b9a85"
    group(kind,{"width":.64,"depth":.64,"height":1.1},color)
    fabric=material("BODY_"+kind,color,"fabric",primary=True)
    frame=material("PAINT_ChairWarmWhite","#d6d4c9",rough=.43) if task else DARK
    cylinder("Office chair gas piston",(0,0,.29),.029,.40,STEEL)
    cylinder("Chair underseat adjustment",(0,0,.43),.075,.06,DARK,24)
    for i in range(5):
        a=math.tau*i/5;end=(.29*math.cos(a),.29*math.sin(a),.075)
        rod("Five-star chair spoke",(0,0,.15),end,.018,frame,12)
        for offset in [-.018,.018]:
            wheel=cylinder("Twin office caster",(end[0]+offset,end[1],.04),.039,.026,DARK,20,(0,math.pi/2,0))
    box("Cushioned seat core",(0,-.015,.49),(.50,.48,.09),fabric,.042,5)
    sphere("Seat sculpted comfort pad",(0,-.025,.526),(.49,.45,.055),fabric,32,12)
    for x in [-.268,.268]:
        pipe("Swept arm support",[(x,.13,.46),(x,.13,.58),(x,.09,.67),(x,-.1,.67)],.015,frame,False,2)
        box("Soft armrest",(x,-.03,.68),(.068,.30,.042),frame,.018,4)
    for x in [-.20,.20]:pipe("Back frame rail",[(x,.17,.45),(x,.23,.60),(x,.25,.91),(x,.20,1.02)],.014,frame)
    # Curved upholstered back with a subtly pinched lumbar region.
    back=box("Upholstered ergonomic back",(0,.22,.79),(.45,.09,.47),fabric,.045,5)
    back.rotation_euler.x=-.08
    sphere("Lumbar cushion",(0,.16,.66),(.36,.08,.14),fabric)
    if not task:
        pillow("Chair head cushion",(0,.22,1.055),(.29,.12,.12),fabric)
    else:
        for x in np.linspace(-.17,.17,10):pipe("Back upholstery stitched channel",[(float(x),.166,.62),(float(x),.174,.78),(float(x),.177,.95)],.0014,fabric,False,1)


def floor_bed():
    group("floor-bed",{"width":1.05,"depth":1.80,"height":.14},"#95474a")
    cover=material("BODY_floor-bed","#95474a","fabric",primary=True,pattern="red-pattern")
    box("Floor mattress padding",(0,0,.064),(1.05,1.80,.128),cover,.045,5)
    for z in [.025,.115]:pipe("Floor mattress sewn edge",rounded_outline(1.035,1.785,z,.055),.004,IVORY,True,1)
    cloth("Patterned floor mattress cover",(0,0,.136),(1.035,1.785),cover,.002,.010,30,48,5)


def fan():
    group("pedestal-fan",{"width":.46,"depth":.36,"height":1.25},"#ded6bd")
    body=material("BODY_pedestal-fan","#ded6bd","paint",rough=.49,primary=True)
    orange=material("PAINT_FanAgedOrange","#ad7d4f",rough=.65)
    sphere("Fan heavy base",(0,.035,.036),(.39,.34,.072),body,40,16)
    cylinder("Fan lower stand",(0,.04,.36),.025,.64,body)
    cylinder("Fan chrome telescopic pole",(0,.04,.76),.017,.35,STEEL)
    box("Fan height adjust knob",(.033,.04,.61),(.04,.045,.04),orange,.014)
    sphere("Fan motor housing",(0,.055,1.01),(.15,.20,.15),body)
    for k in range(7):rod("Motor cooling slot",(-.055+k*.017,.152,.986),(-.055+k*.017,.152,1.035),.002,DARK,6)
    for i in range(3):
        a=i*math.tau/3;blade=sphere("Swept fan blade",(.102*math.sin(a),-.04,1.01+.102*math.cos(a)),(.13,.014,.25),body,28,12);blade.rotation_euler.y=-a+.24
    # The cage has curved radial spokes front/back, not a flat painted disk.
    for rear in [False,True]:
        for i in range(20):
            a=math.tau*i/20;pts=[]
            for j in range(13):
                r=.022+.197*j/12;y=(-.108 if not rear else .05)+(r/.219)**2*(.05 if not rear else -.025)
                pts.append((r*math.cos(a),y,1.01+r*math.sin(a)))
            pipe("Curved fan grille spoke",pts,.0016,body,False,1)
    for r in [.045,.085,.125,.165,.205,.222]:
        pipe("Fan grille concentric ring",[(r*math.cos(a),-.065,1.01+r*math.sin(a))for a in np.linspace(0,math.tau,64,endpoint=False)],.0018,body,True,1)
    pipe("Aged orange fan cage rim",[(.224*math.cos(a),-.035,1.01+.224*math.sin(a))for a in np.linspace(0,math.tau,80,endpoint=False)],.006,orange,True,2)
    cylinder("Fan center badge",(0,-.115,1.01),.036,.012,body,32,(math.pi/2,0,0))


def stool():
    group("stool",{"width":.37,"depth":.37,"height":.42},"#795b42")
    body=material("BODY_stool","#795b42","wood",primary=True)
    for x in [-.14,.14]:
        for y in [-.14,.14]:box("Stool solid timber leg",(x,y,.195),(.045,.045,.39),body,.004)
    box("Stool rounded seat",(0,0,.398),(.37,.37,.044),body,.016,4)
    for y in [-.14,.14]:box("Stool lower stretcher",(0,y,.13),(.28,.028,.035),body,.003)
    for x in [-.14,.14]:box("Stool side stretcher",(x,0,.16),(.028,.28,.035),body,.003)


def plant():
    group("plant",{"width":.46,"depth":.46,"height":.9},"#48683d")
    body=material("BODY_plant","#48683d","paint",rough=.67,primary=True)
    cylinder("Terracotta tapered planter",(0,0,.15),.115,.30,TERRACOTTA,48,radius_top=.158)
    pipe("Planter rolled rim",[(.156*math.cos(a),.156*math.sin(a),.294)for a in np.linspace(0,math.tau,64,endpoint=False)],.013,TERRACOTTA,True,2)
    cylinder("Plant dark soil",(0,0,.293),.145,.012,SOIL,48)
    for i in range(17):
        a=i*2.399963;h=.40+(i%6)*.08;r=.115+(i%4)*.027
        tip=Vector((r*math.cos(a),r*math.sin(a),h));root=Vector((.015*math.sin(a),.015*math.cos(a),.29))
        pipe("Plant curved stem",[tuple(root.lerp(tip,t)+Vector((0,0,.035*math.sin(t*math.pi))))for t in np.linspace(0,1,10)],.003,body,False,1)
        # Pointed leaf with central ridge, a curled edge and individual UVs.
        verts=[];uvs=[];faces=[];direction=Vector((math.cos(a),math.sin(a),.5));side=Vector((-math.sin(a),math.cos(a),0))
        for j in range(13):
            t=j/12;width=.055*math.sin(math.pi*t)**.7
            for k in range(5):
                s=(k-2)/2;v=tip+direction*(t-.3)*.20+side*width*s+Vector((0,0,.018*(1-s*s)*math.sin(math.pi*t)-.025*t*t))
                verts.append(tuple(v));uvs.append((k/4,t))
        for j in range(12):
            for k in range(4):q=j*5+k;faces.append((q,q+1,q+6,q+5))
        grid_mesh("Individually shaped leaf",verts,faces,uvs,body if i%3 else GREENLIGHT)


def shelf():
    group("shelf",{"width":.82,"depth":.33,"height":1.58},"#aa8961")
    body=material("BODY_shelf","#aa8961","wood",primary=True)
    for x in [-.39,.39]:box("Oak shelf side",(x,0,.79),(.04,.33,1.58),body,.004)
    for z in [.055,.43,.81,1.19,1.55]:box("Oak shelf board",(0,0,z),(.79,.33,.035),body,.004)
    box("Shelf back panel",(0,.157,.80),(.76,.015,1.50),OAK,.001)
    book_colors=["#7e8a77","#bd9d82","#ddd2b8","#657b80","#775b55"]
    for i in range(13):
        z=.455 if i<6 else .835;x=-.30+(i%6)*.067
        paper=material("PAINT_BookCover"+str(i),book_colors[i%5],rough=.9)
        o=box("Bound book",(x,-.02,z+.135),(.052,.24,.27+(i%3)*.018),paper,.003)
        if i in [5,12]:o.rotation_euler.y=-.15
        for zz in [-.09,.09]:box("Book spine label",(x,-.143,z+.135+zz),(.038,.001,.007),IVORY,.0002)
    cylinder("Ceramic shelf vase",(.21,0,1.32),.075,.21,IVORY,40,radius_top=.048)
    cylinder("Vase lip",(.21,0,1.43),.05,.018,IVORY,40)
    sphere("Shelf decorative bowl",(-.15,0,.19),(.20,.20,.12),TERRACOTTA)


for build in [bed,wardrobe,desk,chair,floor_bed,fan,stool,plant,shelf,
              lambda:bed("bed-platform","platform"),lambda:bed("bed-upholstered","upholstered"),
              lambda:wardrobe("wardrobe-sliding",True),lambda:desk("desk-oak",True),lambda:chair("chair-task",True)]:
    build()

bpy.context.view_layer.update()
summary=[]
for root in ROOTS:
    meshes=[o for o in root.children_recursive if o.type=="MESH"]
    points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
    low=Vector(tuple(min(v[i]for v in points)for i in range(3)));high=Vector(tuple(max(v[i]for v in points)for i in range(3)))
    extent=high-low;center=Vector(((low.x+high.x)/2,(low.y+high.y)/2,low.z))
    transform=Matrix.Diagonal((1/extent.x,1/extent.y,1/extent.z,1))@Matrix.Translation(-center)
    for o in meshes:
        o.data.transform(transform@o.matrix_world);o.matrix_world=Matrix.Identity(4)
    root["normalizedDimensions"]="1,1,1";root["meshCount"]=len(meshes)
    triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in meshes)
    summary.append({"kind":root.name,"sourceBounds":list(extent),"meshes":len(meshes),"triangles":triangles})

ASSETS.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for root in ROOTS:
    root.select_set(True)
    for obj in root.children_recursive:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format="GLB",use_selection=True,
    export_yup=True,export_extras=True,export_animations=False,export_cameras=False,
    export_lights=False,export_apply=True,export_image_format="AUTO")

blob=OUT.read_bytes();magic,version,length=struct.unpack_from("<4sII",blob)
assert magic==b"glTF"and version==2 and length==len(blob)
chunk_length,chunk_type=struct.unpack_from("<II",blob,12);assert chunk_type==0x4E4F534A
doc=json.loads(blob[20:20+chunk_length]);nodes=doc["nodes"];roots=doc["scenes"][doc.get("scene",0)]["nodes"]
assert {nodes[i]["name"]for i in roots}=={root.name for root in ROOTS}
for root_index in roots:
    stack=[root_index];low=[math.inf]*3;high=[-math.inf]*3
    while stack:
        node=nodes[stack.pop()];stack.extend(node.get("children",[]))
        assert not any(k in node for k in ["matrix","rotation","translation","scale"])
        if "mesh"in node:
            for primitive in doc["meshes"][node["mesh"]]["primitives"]:
                assert "TEXCOORD_0"in primitive["attributes"],node["name"]
                a=doc["accessors"][primitive["attributes"]["POSITION"]]
                low=[min(low[i],a["min"][i])for i in range(3)];high=[max(high[i],a["max"][i])for i in range(3)]
    assert all(abs(a-b)<3e-5 for a,b in zip(low,[-.5,0,-.5])),(nodes[root_index]["name"],low)
    assert all(abs(a-b)<3e-5 for a,b in zip(high,[.5,1,.5])),(nodes[root_index]["name"],high)
assert len(blob)<15_000_000
assert sum(s["triangles"]for s in summary)<250_000
assert len([m for m in doc["materials"]if m.get("extras",{}).get("editableColor")])==14
report={"blender":bpy.app.version_string,"bytes":len(blob),"rootCount":len(roots),"triangles":sum(s["triangles"]for s in summary),"embeddedImages":len(doc.get("images",[])),"validation":"PASS:GLB2,14 exact roots,unit bounds,floor contact,identity transforms,all meshes UV mapped,14 primary materials,size/triangle budgets","assets":summary}
print("REALISTIC_ASSET_VALIDATION_PASS\n"+json.dumps(report,indent=2))

if not options.skip_thumbnails:
    # Restore authored proportions for beauty renders; exported normalized GLB
    # is already complete and is not overwritten by the studio staging.
    for root,spec in zip(ROOTS,summary):root.scale=spec["sourceBounds"];root.hide_render=True
    for root in ROOTS:
        for o in root.children_recursive:o.hide_render=True
    scene=bpy.context.scene;scene.render.engine="CYCLES";scene.cycles.device="CPU"
    scene.cycles.samples=20;scene.cycles.use_denoising=True;scene.render.threads_mode="FIXED";scene.render.threads=6
    scene.render.resolution_x=384;scene.render.resolution_y=384;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG";scene.render.film_transparent=False
    scene.world.color=(.18,.18,.18);scene.view_settings.view_transform="AgX";scene.view_settings.look="AgX - Medium High Contrast";scene.view_settings.exposure=-.35
    CURRENT=None
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.008));ground=bpy.context.object
    ground.name="Thumbnail studio ground";ground.data.materials.append(material("PAINT_StudioGround","#c6c1b5",rough=.82))
    for name,loc,energy,size in [("Large softbox",(3,-4,5),450,4),("Warm window",(-3,-1,3.5),250,3),("Rim light",(1,3,4),350,3)]:
        data=bpy.data.lights.new(name,"AREA");data.energy=energy;data.shape="DISK";data.size=size
        light=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(light);light.location=loc;light.rotation_euler=(Vector((0,0,.5))-light.location).to_track_quat("-Z","Y").to_euler()
    camera_data=bpy.data.cameras.new("Furniture preview camera");camera=bpy.data.objects.new("Furniture preview camera",camera_data);bpy.context.collection.objects.link(camera);scene.camera=camera;camera_data.type="ORTHO";camera_data.lens=50
    THUMBS.mkdir(parents=True,exist_ok=True)
    for root,spec in zip(ROOTS,summary):
        w,d,h=spec["sourceBounds"];extent=max(w,d,h)
        root.hide_render=False
        for o in root.children_recursive:o.hide_render=False
        camera.location=(extent*1.55,-extent*2.0,extent*1.4)
        target=Vector((0,0,h*.46));camera.rotation_euler=(target-camera.location).to_track_quat("-Z","Y").to_euler()
        camera_data.ortho_scale=max(h*1.40,(w+d)*.94)
        scene.render.filepath=str(THUMBS/(root.name+".png"))
        bpy.ops.render.render(write_still=True)
        root.hide_render=True
        for o in root.children_recursive:o.hide_render=True
    # The editable source opens as an asset library rather than fourteen
    # overlapping objects. Exported GLB roots deliberately remain at the origin.
    for index,root in enumerate(ROOTS):
        root.location=((index%5)*3.4,(index//5)*3.5,0)
        root.hide_render=False
        for obj in root.children_recursive:obj.hide_render=False
    artifact=ROOT/"artifacts";artifact.mkdir(exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(artifact/"furniture-realistic.blend"))
report["thumbnailsGenerated"]=not options.skip_thumbnails
THUMBS.mkdir(parents=True,exist_ok=True)
(THUMBS/"geometry-report.json").write_text(json.dumps(report,indent=2)+"\n")
