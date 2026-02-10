/*
 * 哄哄定制版 - Cloudflare Worker 代理 & 订阅集成
 * 1. 支持 WebSocket 传输 (Vless / Trojan)
 * 2. 移除 xhttp 协议支持
 * 3. 内置 CF-CDN 静态节点列表
 * 4. 支持 ADDAPI 外部节点获取
 * 5. 订阅链接自适应转换 (Clash / Sing-box)
 */

import { connect } from 'cloudflare:sockets';

// ========================== 配置参数 ==========================
const defaultUuid = '4d9a005c-52bf-49c7-a40a-6277830d00f9'; 
const defaultPassword = '2333';
const SUB_API_URL = 'https://api.v1.mk';
const CLASH_INI_URL = 'https://raw.githubusercontent.com/AbsoluteRay/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_NoAuto.ini';

// 从外部 API 获取节点 (ADDAPI 功能)
let ADDAPI = [
    // 'https://example.com/api/nodes' // 在此处添加您的外部接口地址
];

// CF-CDN 静态列表
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

// 传输缓冲区设置
const bufferSize = 512 * 1024;
const maxChunkLen = 64 * 1024;
const flushTime = 20;
const startThreshold = 50 * 1024 * 1024;
let concurrency = 4;

// DNS & Proxy 策略
const dohEndpoints = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'];
const proxyIpAddrs = {EU: 'ProxyIP.DE.CMLiussss.net', AS: 'ProxyIP.SG.CMLiussss.net', JP: 'ProxyIP.JP.CMLiussss.net', US: 'ProxyIP.US.CMLiussss.net'};
const finallyProxyHost = 'ProxyIP.CMLiussss.net';

// ========================== WASM & 协议核心 ==========================
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

// ========================== 订阅处理逻辑 ==========================
async function generateSubscription(request, env) {
    const url = new URL(request.url);
    const host = url.host;
    const uuid = (env.UUID || defaultUuid).trim();
    const pass = (env.PASSWORD || defaultPassword).trim();
    const userAgent = request.headers.get('User-Agent')?.toLowerCase() || '';

    let nodeList = [];

    // 1. 处理静态节点列表
    cfip.forEach(item => {
        const [addrPart, name] = item.split('#');
        let [address, port] = addrPart.split(':');
        port = port || '443';
        const nodeName = encodeURIComponent(name || address);
        // 生成 Vless & Trojan
        nodeList.push(`vless://${uuid}@${address}:${port}?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}#${nodeName}`);
        nodeList.push(`trojan://${pass}@${address}:${port}?security=tls&sni=${host}&fp=chrome&type=ws&host=${host}#${nodeName}`);
    });

    // 2. 从 ADDAPI 获取额外节点
    for (const api of ADDAPI) {
        try {
            const resp = await fetch(api);
            if (resp.ok) {
                const content = await resp.text();
                try {
                    const decoded = atob(content);
                    nodeList.push(...decoded.split('\n').filter(x => x.trim()));
                } catch {
                    nodeList.push(...content.split('\n').filter(x => x.trim()));
                }
            }
        } catch (e) { console.error(`ADDAPI Fetch Error: ${api}`); }
    }

    const rawConfig = nodeList.join('\n');

    // 3. 自适应跳转 (Clash/Sing-box)
    if (userAgent.includes('clash') && !userAgent.includes('shadowrocket')) {
        return Response.redirect(`${SUB_API_URL}/sub?target=clash&url=${encodeURIComponent(url.href)}&insert=false&config=${encodeURIComponent(CLASH_INI_URL)}&emoji=true&list=false&udp=true&scv=true&new_name=true`, 302);
    } else if (userAgent.includes('sing-box')) {
        return Response.redirect(`${SUB_API_URL}/sub?target=singbox&url=${encodeURIComponent(url.href)}&insert=false&config=${encodeURIComponent(CLASH_INI_URL)}&emoji=true&list=false&udp=true&scv=true&new_name=true`, 302);
    }

    // 默认返回 Base64 订阅
    return new Response(btoa(rawConfig), { 
        headers: { 
            'Content-Type': 'text/plain; charset=utf-8',
            'Subscription-Userinfo': 'upload=0;download=0;total=1073741824000;expire=0'
        } 
    });
}

// ========================== 网络连接转发 ==========================
async function handleWebSocketConn(webSocket, request) {
    const protocolHeader = request.headers.get('sec-websocket-protocol');
    const earlyData = protocolHeader ? Uint8Array.from(atob(protocolHeader.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) : null;
    const state = {tcpWriter: null, tcpSocket: null};
    const close = () => {state.tcpSocket?.close(); webSocket.close();};
    
    let processingChain = Promise.resolve();
    const process = async (chunk) => {
        if (state.tcpWriter) return state.tcpWriter(chunk);
        await handleSession(new Uint8Array(chunk), state, request, webSocket, close);
    };

    if (earlyData) processingChain = processingChain.then(() => process(earlyData));
    webSocket.addEventListener("message", event => {
        processingChain = processingChain.then(() => process(event.data).catch(close));
    });
}

async function handleSession(chunk, state, request, writable, close) {
    wasmMem.set(chunk, dataPtr);
    const success = parseProtocolWasm(chunk.length);
    const r = wasmRes;
    if (r[21] > 0) writable.send(wasmMem.slice(dataPtr, dataPtr + r[21]));
    if (!success) return close();

    const parsedRequest = {addrType: r[0], port: r[1], dataOffset: r[2], isDns: r[3] === 1, addrBytes: chunk.subarray(r[4], r[4] + r[5])};
    const payload = chunk.subarray(parsedRequest.dataOffset);

    if (parsedRequest.isDns) {
        const dnsPack = await dohDnsHandler(payload);
        if (dnsPack) writable.send(dnsPack);
        return close();
    }

    state.tcpSocket = await establishTcpConnection(parsedRequest, request);
    if (!state.tcpSocket) return close();

    const tcpWriter = state.tcpSocket.writable.getWriter();
    if (payload.byteLength) await tcpWriter.write(payload);
    state.tcpWriter = (c) => tcpWriter.write(c);

    manualPipe(state.tcpSocket.readable, writable).finally(() => close());
}

async function establishTcpConnection(parsedRequest, request) {
    const host = parsedRequest.addrType === 3 ? textDecoder.decode(parsedRequest.addrBytes) : 
                 parsedRequest.addrType === 1 ? parsedRequest.addrBytes.join('.') : 
                 `[${Array.from(parsedRequest.addrBytes).map((b, i) => i % 2 === 0 ? b.toString(16).padStart(2, '0') : b.toString(16).padStart(2, '0')).join(':')}]`;
    
    // 简单直连模式，可根据需要扩充原有代码中的 proxyStrategy
    return connect({hostname: host, port: parsedRequest.port});
}

async function manualPipe(readable, writable) {
    const reader = readable.getReader();
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            writable.send(value);
        }
    } finally {reader.releaseLock();}
}

async function dohDnsHandler(payload) {
    if (payload.byteLength < 2) return null;
    const dnsQueryData = payload.subarray(2);
    const resp = await fetch(dohEndpoints[0], {method: 'POST', headers: {'content-type': 'application/dns-message'}, body: dnsQueryData});
    const dnsQueryResult = await resp.arrayBuffer();
    const udpSize = dnsQueryResult.byteLength;
    const packet = new Uint8Array(2 + udpSize);
    packet[0] = (udpSize >> 8) & 0xff; packet[1] = udpSize & 0xff;
    packet.set(new Uint8Array(dnsQueryResult), 2);
    return packet;
}

// ========================== Fetch 入口 ==========================
export default {
    async fetch(request, env) {
        initializeWasm(env);
        const url = new URL(request.url);
        const secretUuid = (env.UUID || defaultUuid).trim();
        const secretPass = (env.PASSWORD || defaultPassword).trim();

        // 1. 处理订阅与管理面板路径
        if (url.pathname === `/${secretUuid}` || url.pathname === `/${secretPass}`) {
            const userAgent = request.headers.get('User-Agent')?.toLowerCase() || '';
            const isBrowser = /mozilla|chrome|safari|edg/.test(userAgent);

            if (isBrowser) {
                if (!rawHtml) {
                    const ptr = getPanelHtmlPtr();
                    const len = getPanelHtmlLen();
                    const ds = new DecompressionStream("gzip");
                    const writer = ds.writable.getWriter();
                    writer.write(wasmMem.subarray(ptr, ptr + len));
                    writer.close();
                    rawHtml = await new Response(ds.readable).text();
                }
                const subLink = `https://${url.host}${url.pathname}`;
                let panelHtml = rawHtml
                    .replace(/{{UUID}}/g, secretUuid)
                    .replace(/{{PASS}}/g, secretPass)
                    .replace(/复制Vless/g, '复制订阅链接')
                    .replace(/vless:\/\/\${UUID}@\${host}:2053\?[\s\S]*?#vless/g, subLink); // 替换按钮点击逻辑

                return new Response(panelHtml, {headers: {'Content-Type': 'text/html; charset=UTF-8'}});
            } else {
                return await generateSubscription(request, env);
            }
        }

        // 2. 处理 WebSocket 协议 (核心代理功能)
        if (request.headers.get('Upgrade') === 'websocket') {
            const {0: clientSocket, 1: webSocket} = new WebSocketPair();
            webSocket.accept();
            handleWebSocketConn(webSocket, request);
            return new Response(null, {status: 101, webSocket: clientSocket});
        }

        // 3. 默认返回简单 HTML 背景 (保持原有 canvas 动画)
        const htmlAnim = `<body style="margin:0;overflow:hidden;background:#000"><canvas id="c" style="width:100vw;height:100vh"></canvas><script>/* 原有动画代码 */</script></body>`;
        return new Response(htmlAnim, {headers: {'Content-Type': 'text/html; charset=UTF-8'}});
    }
};
