const express=require('express'),multer=require('multer'),crypto=require('crypto'),path=require('path'),fs=require('fs');
const {DatabaseSync}=require('node:sqlite');
const DIR=process.env.DATA_DIR||__dirname,UP=path.join(DIR,'uploads');fs.mkdirSync(UP,{recursive:true});
const db=new DatabaseSync(path.join(DIR,'data.db'));
db.exec(`CREATE TABLE IF NOT EXISTS categories(slug TEXT PRIMARY KEY,fr TEXT,ar TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name_fr TEXT,name_ar TEXT,desc_fr TEXT,desc_ar TEXT,category TEXT,price REAL,discount REAL DEFAULT 0,images TEXT DEFAULT '[]',specs TEXT DEFAULT '[]',variants TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,wilaya TEXT,address TEXT,items TEXT,total REAL,status TEXT DEFAULT 'pending',created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT);`);
const getS=k=>(db.prepare('SELECT v FROM settings WHERE k=?').get(k)||{}).v;
const setS=(k,v)=>db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(k,String(v));
const hash=p=>{const s=crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(p,s,64).toString('hex')};
const check=(p,h)=>{const [s,x]=h.split(':');return crypto.timingSafeEqual(crypto.scryptSync(p,s,64),Buffer.from(x,'hex'))};
if(!db.prepare('SELECT 1 FROM categories').get())[['men','Homme','رجال'],['women','Femme','نساء'],['shoes','Chaussures','أحذية'],['bags','Sacs','حقائب'],['watches','Montres','ساعات'],['accessories','Accessoires','إكسسوارات']].forEach(c=>db.prepare('INSERT INTO categories VALUES(?,?,?)').run(...c));
if(!getS('pass')){setS('pass',hash(process.env.ADMIN_PASS||'admin123'));setS('shop','MAISON');setS('whatsapp','213555000000');console.log('Admin password: '+(process.env.ADMIN_PASS||'admin123')+' (change it in Settings)')}
const app=express(),sessions=new Map(),fails=new Map();
app.use(express.json());app.use('/uploads',express.static(UP));app.use(express.static(path.join(__dirname,'public')));
const upload=multer({storage:multer.diskStorage({destination:UP,filename:(q,f,cb)=>cb(null,crypto.randomBytes(8).toString('hex')+path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g,''))}),limits:{fileSize:8e6},fileFilter:(q,f,cb)=>cb(null,/^image\//.test(f.mimetype))});
const wrap=f=>(q,r)=>{try{f(q,r)}catch(e){console.error(e);r.status(e.code||500).json({error:e.message})}};
const err=(m,c=400)=>Object.assign(new Error(m),{code:c});
const prod=r=>{const images=JSON.parse(r.images),specs=JSON.parse(r.specs),variants=JSON.parse(r.variants);return{...r,images,specs,variants,final:Math.round(r.price*(1-r.discount/100)),stock:variants.reduce((a,v)=>a+v.stock,0)}};
const auth=(q,r,n)=>{const t=((q.headers.cookie||'').match(/sid=([a-f0-9]+)/)||[])[1];if(t&&sessions.has(t))return n();r.status(401).json({error:'auth'})};
// public
app.get('/api/shop',wrap((q,r)=>r.json({shop:getS('shop'),whatsapp:getS('whatsapp'),categories:db.prepare('SELECT * FROM categories').all()})));
app.get('/api/products',wrap((q,r)=>r.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(prod))));
app.post('/api/orders',wrap((q,r)=>{
  const{name,phone,wilaya,address,items}=q.body;if(!name||!/^[0-9+ ]{8,15}$/.test(phone||'')||!wilaya||!Array.isArray(items)||!items.length)throw err('Missing or invalid fields');
  let total=0;const lines=items.map(i=>{const p=db.prepare('SELECT * FROM products WHERE id=?').get(i.id);if(!p)throw err('Product not found');const P=prod(p),v=P.variants.find(v=>v.size==i.size&&v.color==i.color),n=Math.max(1,parseInt(i.qty)||1);
    if(!v||v.stock<n)throw err(`Out of stock: ${P.name_fr} ${i.size||''} ${i.color||''}`,409);total+=P.final*n;return{id:P.id,name:P.name_fr,size:i.size,color:i.color,qty:n,price:P.final}});
  const x=db.prepare('INSERT INTO orders(name,phone,wilaya,address,items,total) VALUES(?,?,?,?,?,?)').run(name,phone,wilaya,address||'',JSON.stringify(lines),total);r.json({id:Number(x.lastInsertRowid),total})}));
// admin
app.post('/api/admin/login',wrap((q,r)=>{const ip=q.ip,f=fails.get(ip)||0;if(f>=5)throw err('Too many attempts. Try again in 15 minutes.',429);
  if(!check(String(q.body.password||''),getS('pass'))){fails.set(ip,f+1);setTimeout(()=>fails.delete(ip),9e5);throw err('Wrong password',401)}
  const t=crypto.randomBytes(24).toString('hex');sessions.set(t,1);r.setHeader('Set-Cookie',`sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);r.json({ok:1})}));
app.post('/api/admin/logout',(q,r)=>{sessions.delete(((q.headers.cookie||'').match(/sid=([a-f0-9]+)/)||[])[1]);r.json({ok:1})});
app.get('/api/admin/me',auth,(q,r)=>r.json({ok:1}));
const save=(q,r)=>{const d=JSON.parse(q.body.data),old=q.params.id?db.prepare('SELECT * FROM products WHERE id=?').get(q.params.id):null;
  const keep=JSON.parse(q.body.keep||'[]'),imgs=keep.concat((q.files||[]).map(f=>'/uploads/'+f.filename));
  if(!d.name_fr||!d.category||!(d.price>=0))throw err('Name, category and price are required');
  const vals=[d.name_fr,d.name_ar||d.name_fr,d.desc_fr||'',d.desc_ar||'',d.category,+d.price,Math.min(90,Math.max(0,+d.discount||0)),JSON.stringify(imgs),JSON.stringify(d.specs||[]),JSON.stringify((d.variants||[]).map(v=>({size:v.size||'',color:v.color||'',stock:Math.max(0,parseInt(v.stock)||0)})))];
  if(old){db.prepare('UPDATE products SET name_fr=?,name_ar=?,desc_fr=?,desc_ar=?,category=?,price=?,discount=?,images=?,specs=?,variants=? WHERE id=?').run(...vals,old.id);JSON.parse(old.images).filter(i=>!imgs.includes(i)).forEach(i=>fs.rmSync(path.join(UP,path.basename(i)),{force:1}))}
  else db.prepare('INSERT INTO products(name_fr,name_ar,desc_fr,desc_ar,category,price,discount,images,specs,variants) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...vals);r.json({ok:1})};
app.post('/api/admin/products',auth,upload.array('images',8),wrap(save));
app.put('/api/admin/products/:id',auth,upload.array('images',8),wrap(save));
app.delete('/api/admin/products/:id',auth,wrap((q,r)=>{const p=db.prepare('SELECT images FROM products WHERE id=?').get(q.params.id);if(p)JSON.parse(p.images).forEach(i=>fs.rmSync(path.join(UP,path.basename(i)),{force:1}));db.prepare('DELETE FROM products WHERE id=?').run(q.params.id);r.json({ok:1})}));
app.post('/api/admin/categories',auth,wrap((q,r)=>{const{fr,ar}=q.body;if(!fr)throw err('Name required');const slug=fr.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+Date.now().toString(36);db.prepare('INSERT INTO categories VALUES(?,?,?)').run(slug,fr,ar||fr);r.json({ok:1})}));
app.put('/api/admin/categories/:s',auth,wrap((q,r)=>{db.prepare('UPDATE categories SET fr=?,ar=? WHERE slug=?').run(q.body.fr,q.body.ar||q.body.fr,q.params.s);r.json({ok:1})}));
app.delete('/api/admin/categories/:s',auth,wrap((q,r)=>{if(db.prepare('SELECT 1 FROM products WHERE category=?').get(q.params.s))throw err('Move or delete the products in this category first',409);db.prepare('DELETE FROM categories WHERE slug=?').run(q.params.s);r.json({ok:1})}));
app.get('/api/admin/orders',auth,wrap((q,r)=>r.json(db.prepare('SELECT * FROM orders ORDER BY id DESC').all().map(o=>({...o,items:JSON.parse(o.items)})))));
const HOLD=['confirmed','shipped','delivered'];
const adjust=(items,sign)=>items.forEach(i=>{const p=db.prepare('SELECT variants FROM products WHERE id=?').get(i.id);if(!p)return;const vs=JSON.parse(p.variants),v=vs.find(v=>v.size==i.size&&v.color==i.color);if(!v)return;if(sign<0&&v.stock<i.qty)throw err(`Not enough stock for ${i.name} ${i.size||''} ${i.color||''}`,409);v.stock+=sign*i.qty;db.prepare('UPDATE products SET variants=? WHERE id=?').run(JSON.stringify(vs),i.id)});
app.put('/api/admin/orders/:id',auth,wrap((q,r)=>{const o=db.prepare('SELECT * FROM orders WHERE id=?').get(q.params.id),s=q.body.status;if(!o||!['pending','confirmed','shipped','delivered','cancelled'].includes(s))throw err('Invalid');
  const items=JSON.parse(o.items),was=HOLD.includes(o.status),will=HOLD.includes(s);db.exec('BEGIN');try{if(!was&&will)adjust(items,-1);if(was&&!will)adjust(items,1);db.prepare('UPDATE orders SET status=? WHERE id=?').run(s,o.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}r.json({ok:1})}));
app.get('/api/admin/stats',auth,wrap((q,r)=>{const ps=db.prepare('SELECT * FROM products').all().map(prod),m=db.prepare("SELECT strftime('%Y-%m',created) m,COUNT(*) n,SUM(total) t FROM orders WHERE status IN ('confirmed','shipped','delivered') GROUP BY m ORDER BY m DESC LIMIT 6").all();
  r.json({revenue:m.reduce((a,x)=>a+x.t,0),months:m,pending:db.prepare("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n,orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n,products:ps.length,out:ps.filter(p=>!p.stock).map(p=>p.name_fr)})}));
app.get('/api/admin/settings',auth,wrap((q,r)=>r.json({shop:getS('shop'),whatsapp:getS('whatsapp')})));
app.put('/api/admin/settings',auth,wrap((q,r)=>{setS('shop',q.body.shop||'MAISON');setS('whatsapp',(q.body.whatsapp||'').replace(/\D/g,''));if(q.body.password){if(q.body.password.length<8)throw err('Password: 8 characters minimum');setS('pass',hash(q.body.password))}r.json({ok:1})}));
app.listen(process.env.PORT||3000,()=>console.log('Store: http://localhost:'+(process.env.PORT||3000)+'  Admin: /admin.html'));
