"""Bound input photos for vision review without changing product content."""
import json,pathlib,sys
from PIL import Image,ImageOps
root=pathlib.Path(sys.argv[1]);report=json.loads((root/'extraction-report.json').read_text());photos=[]
(root/'vision').mkdir(exist_ok=True)
for i,photo in enumerate(report['photos'][:6]):
 image=Image.open(root/photo['file']);
 if image.width*image.height>25_000_000:raise ValueError('The product photo exceeds the pixel limit.')
 image=ImageOps.exif_transpose(image).convert('RGB');image.thumbnail((1024,1024));path=root/'vision'/f'image-{i}.jpg';image.save(path,quality=87,optimize=True);photos.append({'id':photo.get('id',f'listing-{i}'),'file':str(path),'mime':'image/jpeg'})
print(json.dumps(photos))
