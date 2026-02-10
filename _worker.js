/*
 * 支持 websocket 传输，trojan 和 vless 协议入站
 * 已集成订阅功能，支持自适应转换 (Clash/Sing-box/Shadowrocket)
 */
import { connect } from 'cloudflare:sockets';

// 配置参数
const defaultUuid = '4d9a005c-52bf-49c7-a40a-6277830d00f9'; 
const defaultPassword = '2333';
const SUB_API_URL = 'https://api.v1.mk';
const CLASH_INI_URL = 'https://raw.githubusercontent.com/AbsoluteRay/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_NoAuto.ini';

const bufferSize = 512 * 1024;
const startThreshold = 50 * 1024 * 1024;
const maxChunkLen = 64 * 1024;
const flushTime = 20;
let concurrency = 4;

const proxyStrategyOrder = ['socks', 'http', 'nat64'];
const dohEndpoints = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'];
const dohNatEndpoints = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];
const proxyIpAddrs = { EU: 'ProxyIP.DE.CMLiussss.net', AS: 'ProxyIP.SG.CMLiussss.net', JP: 'ProxyIP.JP.CMLiussss.net', US: 'ProxyIP.US.CMLiussss.net' };
const finallyProxyHost = 'ProxyIP.CMLiussss.net';

const coloRegions = {
    JP: new Set(['FUK', 'ICN', 'KIX', 'NRT', 'OKA']),
    EU: new Set(['ACC', 'ADB', 'ALA', 'ALG', 'AMM', 'AMS', 'ARN', 'ATH', 'BAH', 'BCN', 'BEG', 'BGW', 'BOD', 'BRU', 'BTS', 'BUD', 'CAI', 'CDG', 'CPH', 'CPT', 'DAR', 'DKR', 'DMM', 'DOH', 'DUB', 'DUR', 'DUS', 'DXB', 'EBB', 'EDI', 'EVN', 'FCO', 'FRA', 'GOT', 'GVA', 'HAM', 'HEL', 'HRE', 'IST', 'JED', 'JIB', 'JNB', 'KBP', 'KEF', 'KWI', 'LAD', 'LED', 'LHR', 'LIS', 'LOS', 'LUX', 'LYS', 'MAD', 'MAN', 'MCT', 'MPM', 'MRS', 'MUC', 'MXP', 'NBO', 'OSL', 'OTP', 'PMO', 'PRG', 'RIX', 'RUH', 'RUN', 'SKG', 'SOF', 'STR', 'TBS', 'TLL', 'TLV', 'TUN', 'VIE', 'VNO', 'WAW', 'ZAG', 'ZRH']),
    AS: new Set(['ADL', 'AKL', 'AMD', 'BKK', 'BLR', 'BNE', 'BOM', 'CBR', 'CCU', 'CEB', 'CGK', 'CMB', 'COK', 'DAC', 'DEL', 'HAN', 'HKG', 'HYD', 'ISB', 'JHB', 'JOG', 'KCH', 'KHH', 'KHI', 'KTM', 'KUL', 'LHE', 'MAA', 'MEL', 'MFM', 'MLE', 'MNL', 'NAG', 'NOU', 'PAT', 'PBH', 'PER', 'PNH', 'SGN', 'SIN', 'SYD', 'TPE', 'ULN', 'VTE'])
};

const coloToProxyMap = new Map();
for (const [region, colos] of Object.entries(coloRegions)) { for (const colo of colos) coloToProxyMap.set(colo, proxyIpAddrs[region]) }

const textEncoder = new TextEncoder(), textDecoder = new TextDecoder();

// WASM 导入
import wasmModule from './protocol.wasm';
const instance = new WebAssembly.Instance(wasmModule, { env: { abort: () => { } } });
const { memory, getUuidPtr, getResultPtr, getDataPtr, getHttpAuthPtr, setHttpAuthLenWasm, parseProtocolWasm, parseUrlWasm, initCredentialsWasm, getPanelHtmlPtr, getPanelHtmlLen } = instance.exports;
const wasmMem = new Uint8Array(memory.buffer);
const wasmRes = new Int32Array(memory.buffer, getResultPtr(), 32);
const dataPtr = getDataPtr();

let isInitialized = false, rawHtml = null;

const initializeWasm = (env) => {
    if (isInitialized) return;
    const cleanUuid = (env.UUID || defaultUuid).trim().replace(/-/g, "");
    if (cleanUuid.length === 32) {
        wasmRes[18] = 1;
        const uuidBytes = new Uint8Array(16);
        for (let i = 0, c; i < 16; i++) { uuidBytes[i] = (((c = cleanUuid.charCodeAt(i * 2)) > 64 ? c + 9 : c) & 0xF) << 4 | (((c = cleanUuid.charCodeAt(i * 2 + 1)) > 64 ? c + 9 : c) & 0xF); }
        wasmMem.set(uuidBytes, getUuidPtr());
    }
    const password = (env.PASSWORD || defaultPassword).trim();
    if (password.length > 0) {
        wasmRes[19] = 1;
        const passBytes = textEncoder.encode(password);
        wasmMem.set(passBytes, dataPtr);
        initCredentialsWasm(passBytes.length);
    }
    isInitialized = true;
};

// ---------------- 订阅生成逻辑 ----------------
async function getSubscription(request, env) {
    const url = new URL(request.url);
    const host = url.host;
    const uuid = (env.UUID || defaultUuid).trim();
    const pass = (env.PASSWORD || defaultPassword).trim();
    const userAgent = request.headers.get('User-Agent')?.toLowerCase() || '';

    // 生成原始 Vless/Trojan 节点信息
    const vlessMain = `vless://${uuid}@${host}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}#${host}_Vless`;
    const trojanMain = `trojan://${pass}@${host}:443?security=tls&sni=${host}&fp=chrome&type=ws&host=${host}#${host}_Trojan`;
    const base64Config = btoa(`${vlessMain}\n${trojanMain}`);

    // 自适应转换判断
    if (userAgent.includes('clash') && !userAgent.includes('shadowrocket')) {
        return Response.redirect(`${SUB_API_URL}/sub?target=clash&url=${encodeURIComponent(url.href)}&insert=false&config=${encodeURIComponent(CLASH_INI_URL)}&emoji=true&list=false&udp=true&tfo=false&scv=true&fdn=false&sort=false&new_name=true`, 302);
    } else if (userAgent.includes('sing-box')) {
        return Response.redirect(`${SUB_API_URL}/sub?target=singbox&url=${encodeURIComponent(url.href)}&insert=false&config=${encodeURIComponent(CLASH_INI_URL)}&emoji=true&list=false&udp=true&tfo=false&scv=true&fdn=false&sort=false&new_name=true`, 302);
    }

    return new Response(base64Config, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// ---------------- 辅助函数 ----------------
const binaryAddrToString = (addrType, addrBytes) => {
    if (addrType === 3) return textDecoder.decode(addrBytes);
    if (addrType === 1) return `${addrBytes[0]}.${addrBytes[1]}.${addrBytes[2]}.${addrBytes[3]}`;
    let ipv6 = ((addrBytes[0] << 8) | addrBytes[1]).toString(16);
    for (let i = 1; i < 8; i++) ipv6 += ':' + ((addrBytes[i * 2] << 8) | addrBytes[i * 2 + 1]).toString(16);
    return `[${ipv6}]`;
};

const parseHostPort = (addr, defaultPort) => {
    let host = addr, port = defaultPort, idx;
    if (addr.charCodeAt(0) === 91) {
        if ((idx = addr.indexOf(']:')) !== -1) {
            host = addr.substring(0, idx + 1);
            port = addr.substring(idx + 2);
        }
    } else if ((idx = addr.lastIndexOf(':')) !== -1) {
        host = addr.substring(0, idx);
        port = addr.substring(idx + 1);
    }
    return [host, (port = parseInt(port), isNaN(port) ? defaultPort : port)];
};

const createConnect = (hostname, port, socket = connect({ hostname, port })) => socket.opened.then(() => socket);
const concurrentConnect = (hostname, port, limit = concurrency) => {
    if (limit === 1) return createConnect(hostname, port);
    return Promise.any(Array(limit).fill(null).map(() => createConnect(hostname, port)));
};

// ... (此处省略 establishTcpConnection/manualPipe 等原有转发逻辑, 保持与原文件一致以确保核心转发功能) ...
// [提示：为了保持回答精简，转发核心逻辑 handleSession, establishTcpConnection 等请保留原文件内容]

// 修改后的 fetch 入口
export default {
    async fetch(request, env) {
        initializeWasm(env);
        
        const url = new URL(request.url);
        const secretUuid = (env.UUID || defaultUuid).trim();
        const secretPass = (env.PASSWORD || defaultPassword).trim();

        // 1. 处理订阅请求 (匹配路径为 UUID 或 Password)
        if (url.pathname === `/${secretUuid}` || url.pathname === `/${secretPass}`) {
            // 如果是浏览器访问，显示面板；如果是代理软件访问，返回订阅
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
                
                // 替换面板中的复制逻辑为订阅链接
                let panelHtml = rawHtml
                    .replace(/{{UUID}}/g, secretUuid)
                    .replace(/{{PASS}}/g, secretPass)
                    .replace(/复制Vless/g, '复制订阅链接')
                    .replace(/vless:\/\/\${UUID}@\${host}:2053\?[\s\S]*?#vless/g, `https://${url.host}${url.pathname}`);

                return new Response(panelHtml, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
            } else {
                return getSubscription(request, env);
            }
        }

        // 2. 处理 WebSocket 协议转发
        if (request.headers.get('Upgrade') === 'websocket') {
            const { 0: clientSocket, 1: webSocket } = new WebSocketPair();
            webSocket.accept();
            handleWebSocketConn(webSocket, request);
            return new Response(null, { status: 101, webSocket: clientSocket });
        }

        // 3. 默认返回背景 HTML
        const bgHtml = `<body style=margin:0;overflow:hidden;background:#000><canvas id=c style=width:100vw;height:100vh>...省略原有Canvas代码...</canvas></body>`;
        return new Response(bgHtml, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }
};

/** 原有 handleWebSocketConn 和 handleSession 逻辑请放在此处 **/
async function handleWebSocketConn(webSocket, request) {
    const protocolHeader = request.headers.get('sec-websocket-protocol');
    const earlyData = protocolHeader ? Uint8Array.from(atob(protocolHeader.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) : null;
    const state = { tcpWriter: null, tcpSocket: null };
    const close = () => { state.tcpSocket?.close(); webSocket.close(); };
    let processingChain = Promise.resolve();
    const process = async (chunk) => {
        if (state.tcpWriter) return state.tcpWriter(chunk);
        await handleSession(new Uint8Array(chunk), state, request, webSocket, close);
    };
    if (earlyData) processingChain = processingChain.then(() => process(earlyData));
    webSocket.addEventListener("message", event => { processingChain = processingChain.then(() => process(event.data).catch(close)) });
}

async function handleSession(chunk, state, request, writable, close) {
    wasmMem.set(chunk, dataPtr);
    const success = parseProtocolWasm(chunk.length);
    const r = wasmRes;
    if (r[21] > 0) writable.send(wasmMem.slice(dataPtr, dataPtr + r[21]));
    if (!success) return close();
    const parsedRequest = { addrType: r[0], port: r[1], dataOffset: r[2], isDns: r[3] === 1, addrBytes: chunk.subarray(r[4], r[4] + r[5]) };
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
    // 此处保留您原有的 establishTcpConnection 实现...
    // 主要是处理 s5/http/proxyip 等连接逻辑
    const hostname = binaryAddrToString(parsedRequest.addrType, parsedRequest.addrBytes);
    return concurrentConnect(hostname, parsedRequest.port);
}

async function manualPipe(readable, writable) {
    const reader = readable.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            writable.send(value);
        }
    } finally { reader.releaseLock(); }
}

async function dohDnsHandler(payload) {
    if (payload.byteLength < 2) return null;
    const dnsQueryData = payload.subarray(2);
    const resp = await fetch(dohEndpoints[0], { method: 'POST', headers: { 'content-type': 'application/dns-message' }, body: dnsQueryData });
    const dnsQueryResult = await resp.arrayBuffer();
    const udpSize = dnsQueryResult.byteLength;
    const packet = new Uint8Array(2 + udpSize);
    packet[0] = (udpSize >> 8) & 0xff; packet[1] = udpSize & 0xff;
    packet.set(new Uint8Array(dnsQueryResult), 2);
    return packet;
}
