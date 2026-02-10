import { connect } from 'cloudflare:sockets';

// ========================== 1. 用户配置 ==========================
const userID = '4d9a005c-52bf-49c7-a40a-6277830d00f9'; // 你的 UUID (用于访问后台面板)
const defaultSub = 'honghong123'; // 你的订阅 Token (用于订阅地址，建议修改为随机 字母+数字)

// 优选 IP 配置
const proxyIPs = { 
    'US': 'ProxyIP.US.CMLiussss.net',
    'EU': 'ProxyIP.DE.CMLiussss.net',
    'SG': 'ProxyIP.SG.CMLiussss.net',
    'JP': 'ProxyIP.JP.CMLiussss.net',
    'CN': 'ProxyIP.CMLiussss.net'
};

// 外部节点来源 (ADDAPI)
let ADDAPI = [
    // 'https://你的其他订阅链接.com' 
];

// 内置 CF-CDN 静态节点列表
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
    'cdn.9889888.xyz:443#♥哄哄CDN线路 E♥',
    'cf.090227.xyz:443#♥哄哄CDN线路 Q♥'
];

// 订阅转换后端
const subConverter = 'https://api.v1.mk/sub?target=clash&url={url}&insert=false&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true';
const subConfig = 'https://raw.githubusercontent.com/AbsoluteRay/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_NoAuto.ini';

// ========================== 2. 核心路由逻辑 ==========================

export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            const upgradeHeader = request.headers.get('Upgrade');
            
            // 获取环境变量或默认配置
            const UUID = (env.UUID || userID).trim();
            const SUB_TOKEN = (env.SUB || defaultSub).trim();

            // 1. 处理 WebSocket 流量 (VLESS/Trojan 代理)
            if (upgradeHeader === 'websocket') {
                return await vlessOverWSHandler(request, UUID);
            }

            // 2. 路由：管理面板 (匹配 UUID)
            if (url.pathname === `/${UUID}`) {
                return new Response(getHtmlPanel(UUID, SUB_TOKEN, url.host), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // 3. 路由：订阅地址 (匹配 Sub Token)
            if (url.pathname === `/${SUB_TOKEN}`) {
                return await getSubscription(url, UUID, request.headers.get('User-Agent'));
            }

            // 4. 默认首页 (404 或伪装页)
            return new Response('Not Found', { status: 404 });

        } catch (err) {
            return new Response(err.toString(), { status: 500 });
        }
    }
};

// ========================== 3. 订阅生成逻辑 ==========================

async function getSubscription(url, uuid, userAgent) {
    userAgent = userAgent ? userAgent.toLowerCase() : '';
    let nodeList = [];
    const host = url.host;

    // A. 生成内置节点
    cfip.forEach(item => {
        const [addr, ps] = item.split('#');
        const [ip, port] = addr.split(':');
        // VLESS 格式
        nodeList.push(`vless://${uuid}@${ip}:${port||443}?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#${encodeURIComponent(ps||ip)}`);
    });

    // B. 获取 ADDAPI 节点
    if (ADDAPI && ADDAPI.length > 0) {
        for (const api of ADDAPI) {
            try {
                const resp = await fetch(api);
                if (resp.ok) {
                    const text = await resp.text();
                    try { nodeList.push(atob(text)); } catch { nodeList.push(text); }
                }
            } catch {}
        }
    }

    const rawSub = nodeList.join('\n');

    // C. 格式转换 (Clash / Singbox) - 仅当 User-Agent 匹配时跳转转换
    if (userAgent.includes('clash') && !userAgent.includes('shadowrocket')) {
        const clashUrl = subConverter
            .replace('{url}', encodeURIComponent(url.href))
            + `&config=${encodeURIComponent(subConfig)}`;
        return Response.redirect(clashUrl, 302);
    }
    
    if (userAgent.includes('sing-box') || userAgent.includes('singbox')) {
        const singboxUrl = subConverter
            .replace('{url}', encodeURIComponent(url.href))
            .replace('target=clash', 'target=singbox')
            + `&config=${encodeURIComponent(subConfig)}`;
         return Response.redirect(singboxUrl, 302);
    }

    // D. 默认返回 Base64 编码的订阅内容 (标准 V2Ray/Shadowrocket 格式)
    return new Response(btoa(rawSub), {
        headers: { 
            "Content-Type": "text/plain; charset=utf-8",
            "Profile-Update-Interval": "24",
            "Subscription-Userinfo": "upload=0; download=0; total=10737418240000; expire=0"
        }
    });
}

// ========================== 4. HTML 面板 (JS原生) ==========================

function getHtmlPanel(uuid, subToken, host) {
    // 关键：现在的订阅链接是 /SUB_TOKEN，而不是 /UUID
    const subLink = `https://${host}/${subToken}`;
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Worker VLESS Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0f0f0f; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e1e1e; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); text-align: center; max-width: 400px; width: 90%; }
            h1 { color: #a855f7; margin-bottom: 1.5rem; }
            .info-group { text-align: left; background: #2d2d2d; padding: 15px; border-radius: 8px; margin-bottom: 1.5rem; }
            .info-item { margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px; }
            .info-item:last-child { border-bottom: none; margin-bottom: 0; }
            .label { color: #888; font-size: 0.8em; display: block; margin-bottom: 4px; }
            .value { font-family: monospace; word-break: break-all; color: #eee; font-size: 0.95em; }
            
            button { width: 100%; padding: 12px; margin: 8px 0; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s; font-size: 1rem; }
            .btn-sub { background: #a855f7; color: white; }
            .btn-sub:hover { background: #9333ea; }
            .btn-copy { background: #3b82f6; color: white; }
            .btn-copy:hover { background: #2563eb; }
            .btn-warn { background: #2d2d2d; color: #888; border: 1px solid #444; }
            
            .toast { position: fixed; bottom: 30px; background: rgba(50, 200, 50, 0.9); color: #fff; padding: 12px 24px; border-radius: 6px; opacity: 0; transition: 0.3s; transform: translateY(20px); }
            .show-toast { opacity: 1; transform: translateY(0); }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>节点管理面板</h1>
            
            <div class="info-group">
                <div class="info-item">
                    <span class="label">管理地址 (UUID)</span>
                    <span class="value">/${uuid}</span>
                </div>
                <div class="info-item">
                    <span class="label">订阅 Token</span>
                    <span class="value">${subToken}</span>
                </div>
            </div>
            
            <button class="btn-sub" onclick="copyText('${subLink}')">
                🔗 复制订阅地址
            </button>
            <div style="font-size:0.8em; color:#888; margin-bottom:15px">推荐：填入 v2rayNG / Shadowrocket / Clash 使用</div>

            <button class="btn-copy" onclick="fetchAndCopy()">
                📋 复制节点内容 (Base64)
            </button>
            <div style="font-size:0.8em; color:#666; margin-bottom:5px">手动模式：直接获取 Base64 文本</div>
        </div>
        
        <div id="toast" class="toast">已复制!</div>

        <script>
            function showToast(msg) {
                const t = document.getElementById('toast');
                t.innerText = msg;
                t.classList.add('show-toast');
                setTimeout(() => t.classList.remove('show-toast'), 2000);
            }
            function copyText(text) {
                navigator.clipboard.writeText(text).then(() => showToast('✅ 订阅地址已复制'));
            }
            async function fetchAndCopy() {
                const btn = document.querySelector('.btn-copy');
                const oldText = btn.innerText;
                btn.innerText = '获取中...';
                try {
                    // 访问订阅路径获取内容
                    const resp = await fetch('${subLink}');
                    const content = await resp.text(); // 获取 Base64 内容
                    navigator.clipboard.writeText(content).then(() => showToast('✅ 节点内容已复制'));
                } catch (e) {
                    showToast('❌ 获取失败');
                } finally {
                    btn.innerText = oldText;
                }
            }
        </script>
    </body>
    </html>
    `;
}

// ========================== 5. VLESS 协议解析 (保持原样) ==========================

async function vlessOverWSHandler(request, uuid) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    webSocket.accept();

    let address = '';
    let portWithRandomLog = '';
    const log = (info, event) => {
        console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
    };
    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    // VLESS 协议处理
    let remoteSocketWapper = { value: null };
    let udpStreamWrite = null; 
    let isDns = false;

    // 流处理
    readableWebSocketStream.pipeTo(new WritableStream({
        async write(chunk, controller) {
            if (isDns && udpStreamWrite) {
                return udpStreamWrite(chunk);
            }
            if (remoteSocketWapper.value) {
                const writer = remoteSocketWapper.value.writable.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }

            // 解析 VLESS 头部
            const { hasError, message, port, addressType, host, rawDataIndex } = processVlessHeader(chunk, uuid);
            
            if (hasError) {
                throw new Error(message); // 如果不是 VLESS 协议，抛出错误
            }

            address = host;
            portWithRandomLog = port;

            // 连接目标服务器
            const remoteSocket = connect({ hostname: address, port: port });
            remoteSocketWapper.value = remoteSocket;

            const writer = remoteSocket.writable.getWriter();
            await writer.write(chunk.slice(rawDataIndex)); // 写入剩余数据
            writer.releaseLock();

            // 响应回客户端
            remoteSocket.readable.pipeTo(new WritableStream({
                async write(chunk) {
                    if (webSocket.readyState === WebSocket.OPEN) {
                        webSocket.send(chunk);
                    }
                }
            })).catch(error => console.error('Remote connection closed', error));
        },
        close() { console.log('WebSocket closed'); },
        abort(err) { console.error('WebSocket aborted', err); }
    })).catch(err => console.error('Stream Error', err));

    return new Response(null, { status: 101, webSocket: client });
}

function processVlessHeader(vlessBuffer, userID) {
    if (vlessBuffer.byteLength < 24) {
        return { hasError: true, message: 'invalid data' };
    }
    const version = new Uint8Array(vlessBuffer.slice(0, 1));
    const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
    const cmd = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
    
    if (cmd !== 1 && cmd !== 2) {
        return { hasError: true, message: 'invalid command, only TCP/UDP supported' };
    }

    const portIndex = 18 + optLength + 1;
    const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
    const port = new DataView(portBuffer).getUint16(0);

    const addressIndex = portIndex + 2;
    const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));
    const addressType = addressBuffer[0];

    let addressLength = 0;
    let addressValueIndex = addressIndex + 1;
    let addressValue = '';

    if (addressType === 1) { // IPv4
        addressLength = 4;
        addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
    } else if (addressType === 2) { // Domain
        addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
        addressValueIndex += 1;
        addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
    } else if (addressType === 3) { // IPv6
        addressLength = 16;
        const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
        const ipv6 = [];
        for (let i = 0; i < 8; i++) { ipv6.push(dataView.getUint16(i * 2).toString(16)); }
        addressValue = ipv6.join(':');
    } else {
        return { hasError: true, message: `invalid addressType: ${addressType}` };
    }

    return {
        hasError: false,
        addressType,
        addressValue,
        port,
        host: addressValue,
        rawDataIndex: addressValueIndex + addressLength
    };
}

function makeReadableWebSocketStream(webSocket, earlyDataHeader, log) {
    let readableStreamCancel = false;
    const stream = new ReadableStream({
        start(controller) {
            webSocket.addEventListener('message', (event) => {
                if (readableStreamCancel) return;
                const message = event.data;
                controller.enqueue(message);
            });
            webSocket.addEventListener('close', () => {
                safeCloseWebSocket(webSocket);
                if (!readableStreamCancel) controller.close();
            });
            webSocket.addEventListener('error', (err) => {
                log('webSocket has error');
                controller.error(err);
            });
            const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
            if (error) {
                controller.error(error);
            } else if (earlyData) {
                controller.enqueue(earlyData);
            }
        },
        cancel(reason) {
            if (readableStreamCancel) return;
            log(`ReadableStream was canceled, due to ${reason}`);
            readableStreamCancel = true;
            safeCloseWebSocket(webSocket);
        }
    });
    return stream;
}

function safeCloseWebSocket(socket) {
    try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
            socket.close();
        }
    } catch (error) {
        console.error('safeCloseWebSocket error', error);
    }
}

function base64ToArrayBuffer(base64Str) {
    if (!base64Str) return { earlyData: null };
    try {
        base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
        const decode = atob(base64Str);
        const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
        return { earlyData: arryBuffer.buffer };
    } catch (error) {
        return { error };
    }
}
