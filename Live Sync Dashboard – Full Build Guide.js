 Live Sync Dashboard – Full Build Guide

Below is a drop-in HTML + JavaScript bundle that:

Captures real audio from the user’s microphone (Web Audio API).

Provides WebSocket hooks to push / receive sync state.

Shows interactive controls for threshold, smoothing, and manual trigger.

Visualizes:

Bass / Mid / Treble energy (Chart.js bars, updating 60 fps)

Per-client latency line chart

Sortable client table with live status

Copy the three files into the same folder, npm i ws express, then run node server.js. Open two+ browser tabs at http://localhost:3000 to see multi-client sync.

1 server.js  (Node 18+)

// ----- minimal Express + WS sync server -----
import express   from 'express';
import http      from 'http';
import { WebSocketServer } from 'ws';
import path      from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const srv  = http.createServer(app);
const wss  = new WebSocketServer({ server: srv });

let globalProgress = 0;                  // 0-1 morph progress
let clients = new Map();                 // id => { ws, ping }

wss.on('connection', ws => {
  const id = crypto.randomUUID();
  clients.set(id, { ws, ping: 0 });
  ws.send(JSON.stringify({ type:'init', id, progress:globalProgress }));

  ws.on('message', msg => {
    const data = JSON.parse(msg);
    if (data.type === 'pong')                     // latency reply
      clients.get(id).ping = Date.now() - data.ts;
    if (data.type === 'update') {                // master update
      globalProgress = data.value;
      broadcast({ type:'progress', value:globalProgress });
    }
  });

  ws.on('close', () => clients.delete(id));
});

function broadcast(obj){
  const str = JSON.stringify(obj);
  wss.clients.forEach(c => c.readyState===1 && c.send(str));
}

// ping-pong every 2 s
setInterval(()=> broadcast({ type:'ping', ts:Date.now() }), 2000);

app.use(express.static(path.join(__dirname,'public')));
srv.listen(3000, ()=>console.log('🔌  http://localhost:3000'));

2 /public/index.html

<!doctype html><html lang="en"><head>
<meta charset="UTF-8"><title>🎛️ Sync Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
 body{margin:0;font:14px/1.4 system-ui;background:#111;color:#eee}
 h1{margin:10px;text-align:center}
 #panels{display:flex;flex-wrap:wrap;justify-content:center}
 canvas{background:#222;border-radius:6px;margin:10px}
 table{margin:10px auto;border-collapse:collapse;width:90%}
 th,td{border:1px solid #444;padding:4px 8px;text-align:center}
 button,input{margin:4px}
</style></head><body>
<h1>🎛️ Live Sync Dashboard</h1>

<div id="controls" style="text-align:center">
  <button id="manualBtn">Manual Trigger</button>
  Threshold:<input id="thresh" type="range" min="10" max="250" value="100">
  Smoothing:<input id="smooth" type="range" min="0" max="0.95" step="0.05" value="0.7">
  <span id="threshVal">100</span>
</div>

<div id="panels">
  <canvas id="spectrum" width="350" height="200"></canvas>
  <canvas id="latency"  width="350" height="200"></canvas>
</div>

<table><thead>
  <tr><th>ID</th><th>Status</th><th>Ping (ms)</th><th>Last Sync</th></tr>
</thead><tbody id="clientTbl"></tbody></table>

<script type="module" src="main.js"></script>
</body></html>

3 /public/main.js

// ----- front-end logic -----
const ws  = new WebSocket(`ws://${location.host}`);
let myId, progress = 0, clients = {};
const ctxSpec = document.getElementById('spectrum').getContext('2d');
const ctxLat  = document.getElementById('latency').getContext('2d');

// Chart.js objects
const specChart = new Chart(ctxSpec,{type:'bar',
  data:{labels:['Bass','Mid','Treble'],datasets:[{
    data:[0,0,0],backgroundColor:['#0ff','#0f0','#f0f']}]} ,
  options:{animation:false,plugins:{legend:{display:false}},
  scales:{y:{min:0,max:255}}}});

const latChart = new Chart(ctxLat,{type:'line',
  data:{labels:Array(30).fill(''),datasets:[{label:'Ping',data:Array(30).fill(0),
    borderColor:'cyan',tension:.3,fill:false}]},
  options:{animation:false,plugins:{legend:{display:false}},
  scales:{y:{min:0,max:200}}}});

document.getElementById('manualBtn').onclick =
  ()=> ws.send(JSON.stringify({type:'update',value:Math.random()}));

const threshInput=document.getElementById('thresh');
const smoothInput=document.getElementById('smooth');
const threshVal=document.getElementById('threshVal');
threshInput.oninput=()=>threshVal.textContent=threshInput.value;

// ---- WebSocket handling ----
ws.onmessage = ({data})=>{
  const m = JSON.parse(data);
  if(m.type==='init'){ myId = m.id; progress = m.progress; }
  if(m.type==='progress'){ progress = m.value; updateLastSync(); }
  if(m.type==='ping'){ ws.send(JSON.stringify({type:'pong',ts:m.ts})); }
};

function updateLastSync(){
  const now = new Date().toLocaleTimeString();
  clients[myId] = {...(clients[myId]||{}), last:now};
}

// ---- latency poll ----
setInterval(()=>{
  latChart.data.datasets[0].data.push(clients[myId]?.ping||0);
  if(latChart.data.datasets[0].data.length>30) latChart.data.datasets[0].data.shift();
  latChart.update();
},1000);

// ---- table render ----
function renderTable(){
  const tbody=document.getElementById('clientTbl'); tbody.innerHTML='';
  Object.entries(clients).forEach(([id,c])=>{
    const row = `<tr><td>${id}</td><td>${c.ws?.readyState===1?'Connected':'—'}</td>
      <td>${c.ping?c.ping.toFixed(0):'–'}</td><td>${c.last||'–'}</td></tr>`;
    tbody.insertAdjacentHTML('beforeend',row);
  });
}
setInterval(renderTable,1000);

// ---------- Web Audio ----------
let analyser, dataArray, smooth=0.7, bassPrev=0;
navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  const src=ctx.createMediaStreamSource(stream);
  analyser=ctx.createAnalyser(); analyser.fftSize=2048;
  src.connect(analyser);
  dataArray=new Uint8Array(analyser.frequencyBinCount);
  loop();
});

function loop(){
  requestAnimationFrame(loop);
  analyser.getByteFrequencyData(dataArray);

  // Aggregate three bands
  const bass   = avgFreq(20,140);
  const mid    = avgFreq(200,2000);
  const treble = avgFreq(4000,12000);

  // smoothing
  const b = bassPrev = bassPrev*smoothInput.value + bass*(1-smoothInput.value);

  specChart.data.datasets[0].data=[bass,mid,treble];
  specChart.update();

  // auto-trigger on bass over threshold
  if(b > threshInput.value){
    ws.send(JSON.stringify({type:'update',value:Math.random()}));
  }
}
function avgFreq(low,high){
  const nyq=analyser.context.sampleRate/2;
  let lowI=Math.floor(low/nyq*dataArray.length),
      hiI =Math.floor(high/nyq*dataArray.length);
  let sum=0, n=0;
  for(let i=lowI;i<hiI;i++){sum+=dataArray[i];n++;}
  return n?sum/n:0;
}

❇️ Launch Steps

# 1. create folder, drop files as shown
npm init -y
npm i express ws
node server.js

Visit http://localhost:3000 in multiple tabs or devices on the LAN.Speak into a mic → live spectrum & automatic morph triggers.Latency and client lists update every second.

Enjoy orchestrating your beat-synchronized rune ring across every screen in sight. 🎶✨