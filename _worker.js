/*
 * 哄哄定制版 - 订阅增强型 Worker
 * 功能：内置 CF-CDN 节点列表 + ADDAPI 聚合 + 订阅自适应转换
 * 修改点：强行覆盖 WASM 面板按钮逻辑，将“生成节点”改为“复制订阅”
 */

import { connect } from 'cloudflare:sockets';

// ========================== 1. 基础配置 ==========================
const defaultUuid = '4d9a005c-52bf-49c7-a40a-6277830d00f9'; 
const defaultPassword = '2333';
const SUB_API_URL = 'https://api.v1.mk';
const CLASH_INI_URL = 'https://raw.githubusercontent.com/AbsoluteRay/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_NoAuto.ini';

// ADDAPI 功能：从外部接口获取额外节点
let ADDAPI = []; 

// 内置 CF-CDN 静态列表
let cfip = [ 
    'nexusmods.com:443#♥ 哄哄公益请勿滥用 ♥',
    'da.mfa.gov.ua#♥ 哄哄TG交流群组@honghongtg ♥',
    'cloudflare-ip.mofashi.ltd#♥ 哄哄TG通知频道@honghongll ♥',
    'cloudflare.seeck.cn:443#♥Seeck三网通用线路♥',
    'ctcc.cloudflare.seeck.cn:443#♥Seeck电信专用线路♥',
    'cmcc.cloudflare.seeck.cn:443#♥Seeck移动专用线路♥',
    'cucc.cloudflare.seeck.cn:443#♥Seeck联通专用线路♥',
    'www.shopify.com:443#♥哄哄CDN线路 A♥',
    'www.ntu.edu.sg:443#♥哄哄CDN线路 B♥',
    'nexusmods.com:443#♥哄哄CDN线路 C♥',
    'www.cnae.top:443#♥哄哄CDN线路 D♥',
    'cdn.9889888.xyz:443#♥哄哄CDN线路 E♥',
    'yx.cloudflare.182682.xyz:443#♥哄哄CDN线路 F♥',
    'cloudflare.czkcdn.cn:443#♥哄哄CDN线路 G♥',
    'mfa.gov.ua:443#♥哄哄CDN线路 H♥',
    'saas.sin.fan:443#♥哄哄CDN线路 I♥',
    'cf.008500.xyz:443#♥哄哄CDN线路 J♥',
    'cf.877774.xyz:443#♥哄哄CDN线路 K♥',
    'cf.zhetengsha.eu.org:443#♥哄哄CDN线路 L♥',
    'sub.danfeng.eu.org:443#♥哄哄CDN线路 M♥',
    'cf.130519.xyz:443#♥哄哄CDN线路 N♥',
    'store.ubi.com:443#♥哄哄CDN线路 O♥',
    'cdns.doon.eu.org:443#♥哄哄CDN线路 P♥',
    'cf.090227.xyz:443#♥哄哄CDN线路 Q♥'
];

// ========================== 2. WASM 初始化 ==========================
import wasmModule from './protocol.wasm';
const instance = new WebAssembly.Instance(wasmModule, {env: {abort: () => {}}});
const {memory, getUuidPtr, getResultPtr, getDataPtr, initCredentialsWasm, parseProtocolWasm, getPanelHtmlPtr, getPanelHtmlLen} = instance.exports;
const wasmMem = new Uint8Array(memory.buffer);
const wasmRes = new Int32Array(memory.buffer, getResultPtr(), 32);
const dataPtr = getDataPtr();
const textEncoder = new TextEncoder(), textDecoder = new TextDecoder();

let isInitialized = false, rawHtml = null;

const initializeWasm = (env) => {
    if (isInitialized) return;
    const cleanUuid = (env.UUID || defaultUuid).trim().replace(/-/g, "");
    if (cleanUuid.length === 32) {
        wasmRes[18] = 1;
        const uuidBytes = new Uint8Array(16);
        for (let i = 0, c; i < 16; i++) {
            uuidBytes[i] = (((c = cleanUuid.charCodeAt(i * 2)) > 64 ? c + 9 : c) & 0xF) << 4 | (((c = cleanUuid.charCodeAt(i * 2 + 1)) > 64 ? c + 9 : c) & 0xF);
        }
        wasmMem.set(uuidBytes, getUuidPtr());
    }
    const password = (env.PASSWORD || defaultPassword).trim();
    const passBytes = textEncoder.encode(password);
    wasmMem.set(passBytes, dataPtr);
    initCredentialsWasm(passBytes.length);
    isInitialized = true;
};

// ========================== 3. 订阅生成 & 转换逻辑 ==========================
async function generateSubscription(request, env) {
    const url = new URL(request.url);
    const host = url.host;
    const uuid = (env.UUID || defaultUuid).trim();
    const pass = (env.PASSWORD || defaultPassword).trim();
    const userAgent = request.headers.get('User-Agent')?.toLowerCase() || '';

    let nodeList = [];

    // 内置节点
    cfip.forEach(item => {
        const [addrPart, name] = item.split('#');
        let [address, port] = addrPart.split(':');
        port = port || '443';
        nodeList.push(`vless://${uuid}@${address}:${port}?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}#${encodeURIComponent(name || address)}`);
        nodeList.push(`trojan://${pass}@${address}:${port}?security=tls&sni=${host}&fp=chrome&type=ws&host=${host}#${encodeURIComponent(name || address)}`);
    });

    // ADDAPI 节点
    for (const api of ADDAPI) {
        try {
            const resp = await fetch(api);
            if (resp.ok) {
                const content = await resp.text();
                try { nodeList.push(...atob(content).split('\n').filter(Boolean)); } 
                catch { nodeList.push(...content.split('\n').filter(Boolean)); }
            }
        } catch (e) {}
    }

    const rawConfig = nodeList.join('\n');

    // Clash / Sing-box 转换
    if (userAgent.includes('clash') && !userAgent.includes('shadowrocket')) {
        return Response.redirect(`${SUB_API_URL}/sub?target=clash&url=${encodeURIComponent(url.href)}&insert=false&config=${encodeURIComponent(CLASH_INI_URL)}&emoji=true&list=false&udp=true&scv=true&new_name=true`, 302);
    } else if (userAgent.includes('sing-box')) {
        return Response.redirect(`${SUB_API_URL}/sub?target=singbox&url=${encodeURIComponent(url.href)}&insert=false&config=${encodeURIComponent(CLASH_INI_URL)}&emoji=true&list=false&udp=true&scv=true&new_name=true`, 302);
    }

    return new Response(btoa(rawConfig), { 
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Subscription-Userinfo': 'upload=0;download=0;total=1073741824000;expire=0' } 
    });
}

// ========================== 4. WebSocket 转发逻辑 ==========================
async function handleWebSocketConn(webSocket, request) {
    const protocolHeader = request.headers.get('sec-websocket-protocol');
    const earlyData = protocolHeader ? Uint8Array.from(atob(protocolHeader.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) : null;
    const state = {tcpSocket: null};
    const close = () => {state.tcpSocket?.close(); webSocket.close();};
    
    let processingChain = Promise.resolve();
    const process = async (chunk) => {
        if (state.tcpWriter) return state.tcpWriter(chunk);
        wasmMem.set(new Uint8Array(chunk), dataPtr);
        if (parseProtocolWasm(chunk.byteLength)) {
            const r = wasmRes;
            const host = r[0] === 3 ? textDecoder.decode(new Uint8Array(chunk).subarray(r[4], r[4]+r[5])) : r[0] === 1 ? new Uint8Array(chunk).subarray(r[4], r[4]+4).join('.') : 'google.com';
            state.tcpSocket = await connect({hostname: host, port: r[1]});
            const writer = state.tcpSocket.writable.getWriter();
            state.tcpWriter = (c) => writer.write(c);
            state.tcpSocket.readable.pipeTo(new WritableStream({write(c){ webSocket.send(c); }})).catch(close);
        }
    };

    webSocket.addEventListener("message", event => {
        processingChain = processingChain.then(() => process(event.data).catch(close));
    });
}

// ========================== 5. Fetch 入口 (包含 HTML 强改) ==========================
export default {
    async fetch(request, env) {
        initializeWasm(env);
        const url = new URL(request.url);
        const secretPath = `/${(env.UUID || defaultUuid).trim()}`;

        if (url.pathname === secretPath || url.pathname === `/${(env.PASSWORD || defaultPassword).trim()}`) {
            const userAgent = request.headers.get('User-Agent')?.toLowerCase() || '';
            if (/mozilla|chrome|safari|edg/.test(userAgent)) {
                // 加载 WASM 里的 HTML
                if (!rawHtml) {
                    const ptr = getPanelHtmlPtr(), len = getPanelHtmlLen();
                    const ds = new DecompressionStream("gzip");
                    const writer = ds.writable.getWriter();
                    writer.write(wasmMem.subarray(ptr, ptr + len));
                    writer.close();
                    rawHtml = await new Response(ds.readable).text();
                }

                // --- 强行注入覆盖脚本 ---
                const subLink = `https://${url.host}${url.pathname}`;
                let panelHtml = rawHtml
                    .replace(/复制 WS VLESS/g, '复制订阅链接')
                    .replace(/复制 WS TROJAN/g, '复制订阅链接')
                    .replace(/复制 XHTTP VLESS/g, '移除协议')
                    .replace(/复制 XHTTP TROJAN/g, '移除协议')
                    // 核心修改：通过 script 标签覆盖原始 copy 逻辑
                    .replace('</head>', `
                        <script>
                        window.onload = function() {
                            // 暴力替换所有按钮的点击事件
                            const buttons = document.querySelectorAll('button, .btn, a[class*="btn"]');
                            buttons.forEach(btn => {
                                if(btn.innerText.includes('订阅')) {
                                    btn.onclick = function(e) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        navigator.clipboard.writeText('${subLink}');
                                        alert('订阅链接已复制到剪贴板！');
                                    };
                                }
                                if(btn.innerText.includes('移除')) {
                                    btn.style.display = 'none'; // 隐藏不需要的按钮
                                }
                            });
                        };
                        </script>
                        </head>
                    `);

                return new Response(panelHtml, {headers: {'Content-Type': 'text/html; charset=UTF-8'}});
            } else {
                return await generateSubscription(request, env);
            }
        }

        if (request.headers.get('Upgrade') === 'websocket') {
            const {0: clientSocket, 1: webSocket} = new WebSocketPair();
            webSocket.accept();
            handleWebSocketConn(webSocket, request);
            return new Response(null, {status: 101, webSocket: clientSocket});
        }

        return new Response('Not Found', {status: 404});
    }
};
