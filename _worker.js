import { connect } from 'cloudflare:sockets';

// ==============================================================================
// 1. 用户自定义配置 (请务必修改 UUID 和 subToken)
// ==============================================================================
const userID = '4d9a005c-52bf-49c7-a40a-6277830d00f9'; // 你的 UUID
const subToken = 'honghong123'; // 你的自定义订阅路径 (建议修改为随机 字母+数字，例如 mysecret123)

// 优选 IP 列表 (CF-CDN)
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

// 外部节点来源 (可选)
let ADDAPI = [];

// 订阅转换后端 (如果 api.v1.mk 挂了，可以寻找替代品，或者直接用 V2RayNG 不用转换)
const subConverter = 'https://api.v1.mk/sub?target=clash&url={url}&insert=false&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true';
const subConfig = 'https://raw.githubusercontent.com/AbsoluteRay/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_NoAuto.ini';

// ==============================================================================
// 2. 核心 Worker 逻辑
// ==============================================================================

export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            const upgradeHeader = request.headers.get('Upgrade');
            const UUID = (env.UUID || userID).trim();
            const SUB = (env.SUB || subToken).trim();

            // === 场景 1: WebSocket 代理流量 (VLESS/Trojan) ===
            if (upgradeHeader === 'websocket') {
                return await vlessOverWSHandler(request, UUID);
            }

            // === 场景 2: 访问管理面板 (路径 == UUID) ===
            if (url.pathname === `/${UUID}`) {
                return new Response(getHtmlPanel(UUID, SUB, url.hostname), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // === 场景 3: 获取订阅内容 (路径 == SUB) ===
            if (url.pathname === `/${SUB}`) {
                return await getSubscription(url, UUID, request.headers.get('User-Agent'));
            }

            // === 场景 4: 默认页 ===
            return new Response('Not Found', { status: 404 });

        } catch (err) {
            return new Response(err.toString(), { status: 500 });
        }
    }
};

// ==============================================================================
// 3. 订阅生成器 (处理 502 问题的关键)
// ==============================================================================

async function getSubscription(url, uuid, userAgent) {
    userAgent = userAgent ? userAgent.toLowerCase() : '';
    let nodeList = [];
    const host = url.host;
    const path = url.searchParams.get('path') || '/?ed=2560'; // 获取自定义路径参数

    // A. 生成内置节点 (VLESS)
    cfip.forEach(item => {
        const [addr, ps] = item.split('#');
        const [ip, port] = addr.split(':');
        // 构建 VLESS 链接，注意这里把 host 和 path 放进去了
        const vlessLink = `vless://${uuid}@${ip}:${port || 443}?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=${encodeURIComponent(path)}#${encodeURIComponent(ps || ip)}`;
        nodeList.push(vlessLink);
    });

    // B. 合并外部 API 节点
    if (ADDAPI && ADDAPI.length > 0) {
        for (const api of ADDAPI) {
            try {
                const resp = await fetch(api);
                if (resp.ok) {
                    const text = await resp.text();
                    try { nodeList.push(atob(text)); } catch { nodeList.push(text); }
                }
            } catch { }
        }
    }

    const rawSub = nodeList.join('\n');

    // C. 智能转换 (仅针对 Clash/Singbox)
    // 如果转换服务器 502，用户其实可以使用 Base64 原始格式，只需在客户端选对导入方式
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

    // D. 默认返回 Base64 (通用格式，Shadowrocket/V2RayNG 可用)
    return new Response(btoa(rawSub), {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Profile-Update-Interval": "24",
            "Subscription-Userinfo": "upload=0; download=0; total=10737418240000; expire=0"
        }
    });
}

// ==============================================================================
// 4. HTML 面板 (完全还原 UI)
// ==============================================================================

function getHtmlPanel(uuid, subToken, host) {
    // 默认订阅地址
    const subLink = `https://${host}/${subToken}`;

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NODE LINK PANEL</title>
    <style>
        :root {
            --primary-color: #6366f1;
            --primary-hover: #4f46e5;
            --bg-gradient-start: #f3f4f6;
            --bg-gradient-end: #e5e7eb;
            --card-bg: rgba(255, 255, 255, 0.85);
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #a8c0ff 0%, #3f2b96 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 0;
            color: #333;
        }

        .container {
            background: var(--card-bg);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            padding: 2rem;
            width: 90%;
            max-width: 800px;
            text-align: center;
            margin: 20px 0;
        }

        h1 {
            color: #6366f1;
            font-size: 2rem;
            margin-bottom: 1.5rem;
            text-transform: uppercase;
            letter-spacing: 2px;
            font-weight: 800;
        }

        .info-block {
            background: rgba(255, 255, 255, 0.6);
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 20px;
            text-align: left;
            font-family: monospace;
            font-size: 0.9rem;
            color: #555;
            display: inline-block;
            width: 100%;
            box-sizing: border-box;
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
            border-bottom: 1px dashed #ddd;
            padding-bottom: 5px;
        }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: bold; color: #555; }
        .info-val { color: #6366f1; }

        .section-title {
            font-weight: bold;
            margin: 20px 0 10px;
            font-size: 1.2rem;
            color: #333;
        }

        /* 输入框和开关样式 */
        .input-group {
            margin-bottom: 20px;
        }
        
        input[type="text"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e7ff;
            border-radius: 8px;
            font-size: 1rem;
            outline: none;
            transition: 0.3s;
            box-sizing: border-box;
            text-align: center;
            color: #444;
            background: #fff;
        }
        input[type="text"]:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }

        .checkbox-wrapper {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 15px 0;
            color: #555;
        }
        .checkbox-wrapper input {
            margin-right: 10px;
            transform: scale(1.2);
            cursor: pointer;
        }

        /* 按钮样式 */
        .btn-main {
            background: linear-gradient(90deg, #6366f1, #8b5cf6);
            color: white;
            border: none;
            padding: 15px 30px;
            font-size: 1.1rem;
            font-weight: bold;
            border-radius: 50px;
            cursor: pointer;
            width: 100%;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
            margin-bottom: 15px;
        }
        .btn-main:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.6);
        }
        .btn-main:active {
            transform: translateY(1px);
        }

        /* 订阅链接展示框 */
        .sub-link-display {
            background: #eef2ff;
            border: 1px solid #c7d2fe;
            color: #4338ca;
            padding: 10px;
            border-radius: 8px;
            word-break: break-all;
            font-size: 0.9rem;
            margin-top: 5px;
            cursor: pointer;
        }
        .sub-label {
            font-size: 0.85rem;
            color: #6b7280;
            margin-bottom: 5px;
            display: block;
        }

        /* 说明框 */
        .note-box {
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 8px;
            padding: 15px;
            margin-top: 20px;
            color: #0369a1;
            font-size: 0.9rem;
            text-align: left;
            line-height: 1.6;
        }

        /* 表格样式 */
        .table-container {
            margin-top: 30px;
            overflow-x: auto;
            background: rgba(255,255,255,0.5);
            border-radius: 10px;
            padding: 10px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            color: #4f46e5;
            font-weight: bold;
        }
        td code {
            background: #e0e7ff;
            padding: 2px 5px;
            border-radius: 4px;
            color: #3730a3;
            font-family: monospace;
        }

        /* Toast 提示 */
        #toast {
            visibility: hidden;
            min-width: 250px;
            background-color: #333;
            color: #fff;
            text-align: center;
            border-radius: 5px;
            padding: 16px;
            position: fixed;
            z-index: 1;
            left: 50%;
            bottom: 30px;
            transform: translateX(-50%);
            font-size: 17px;
        }
        #toast.show {
            visibility: visible;
            -webkit-animation: fadein 0.5s, fadeout 0.5s 2.5s;
            animation: fadein 0.5s, fadeout 0.5s 2.5s;
        }

        @-webkit-keyframes fadein {
            from {bottom: 0; opacity: 0;} 
            to {bottom: 30px; opacity: 1;}
        }
        @keyframes fadein {
            from {bottom: 0; opacity: 0;}
            to {bottom: 30px; opacity: 1;}
        }
        @-webkit-keyframes fadeout {
            from {bottom: 30px; opacity: 1;} 
            to {bottom: 0; opacity: 0;}
        }
        @keyframes fadeout {
            from {bottom: 30px; opacity: 1;}
            to {bottom: 0; opacity: 0;}
        }
    </style>
</head>
<body>

<div class="container">
    <h1>NODE LINK PANEL</h1>

    <div class="info-block">
        <div class="info-row">
            <span class="info-label">[DOMAIN]</span>
            <span class="info-val">${host}</span>
        </div>
        <div class="info-row">
            <span class="info-label">[UUID]</span>
            <span class="info-val">${uuid}</span>
        </div>
        <div class="info-row">
            <span class="info-label">[SUB-PATH]</span>
            <span class="info-val">/${subToken}</span>
        </div>
    </div>

    <div class="section-title">自定义路径</div>
    <div class="input-group">
        <input type="text" id="customPath" value="/?ed=2560" placeholder="例如: /?ed=2560">
    </div>

    <div class="checkbox-wrapper">
        <label>
            <input type="checkbox" id="echToggle"> 开启 ECH 增强模式
        </label>
    </div>

    <button class="btn-main" onclick="copySubscription()">复制订阅链接 (通用)</button>
    
    <div style="text-align: left; margin-top: 10px;">
        <span class="sub-label">👇 订阅地址展示 (如果自动导入失败，请复制此链接手动填入):</span>
        <input type="text" id="realSubLink" class="sub-link-display" readonly value="${subLink}?path=/?ed=2560" onclick="this.select()">
    </div>

    <div class="note-box">
        💡 <b>入站协议说明:</b><br>
        1. 点击按钮复制订阅链接，支持 Shadowrocket, Clash, V2RayNG 等。<br>
        2. 如果 Clash 导入时提示 "Bad Gateway" 或 "Failed to fetch"，请尝试直接手动复制上方的订阅地址。<br>
        3. 自定义路径和 ECH 设置会自动更新到订阅参数中。
    </div>

    <div class="section-title" style="margin-top: 40px;">URL 路径参数速查表</div>
    <div class="table-container">
        <table>
            <thead>
                <tr>
                    <th>参数类型</th>
                    <th>功能说明</th>
                    <th>配置示例</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><code>s5/socks</code></td>
                    <td>SOCKS5 代理</td>
                    <td><code>s5=user:pass@host:port</code></td>
                </tr>
                <tr>
                    <td><code>http</code></td>
                    <td>HTTP 代理</td>
                    <td><code>http=user:pass@host:port</code></td>
                </tr>
                <tr>
                    <td><code>nat64</code></td>
                    <td>NAT64 转换</td>
                    <td><code>nat64=[2a01:4f9:c010::]</code></td>
                </tr>
                <tr>
                    <td><code>ip/proxyip</code></td>
                    <td>备用落地 IP</td>
                    <td><code>ip=1.2.3.4:443</code></td>
                </tr>
                <tr>
                    <td><code>proxyall</code></td>
                    <td>全局模式</td>
                    <td><code>proxyall=1</code></td>
                </tr>
            </tbody>
        </table>
        <div style="font-size: 0.8rem; color: #888; margin-top: 10px; text-align: left;">
            注: s5/http/nat64/ip 均支持逗号分隔多个地址。
        </div>
    </div>
</div>

<div id="toast">已复制到剪贴板</div>

<script>
    const baseUrl = "${subLink}";
    const pathInput = document.getElementById('customPath');
    const echCheck = document.getElementById('echToggle');
    const displayInput = document.getElementById('realSubLink');

    function updateLink() {
        let path = pathInput.value;
        if (!path) path = "/?ed=2560"; // 默认值
        
        // 处理 ECH
        // 注意：原版逻辑是将 ECH 参数编码进 path 或 hash，这里为了简化，我们直接展示最通用的 ?path= 参数
        // 实际上 VLESS 协议的 path 修改在 getSubscription 函数中已经处理了
        
        let finalUrl = baseUrl + "?path=" + encodeURIComponent(path);
        
        if (echCheck.checked) {
            // 模拟 ECH 增强模式的参数变化 (根据实际需求调整，这里仅做示例修改参数)
            finalUrl += "&ech=1"; 
        }

        displayInput.value = finalUrl;
    }

    // 监听输入变化
    pathInput.addEventListener('input', updateLink);
    echCheck.addEventListener('change', updateLink);

    function copySubscription() {
        const url = displayInput.value;
        navigator.clipboard.writeText(url).then(() => {
            showToast("订阅链接已复制！");
        }).catch(() => {
            showToast("复制失败，请手动复制下方文本框");
        });
    }

    function showToast(msg) {
        var x = document.getElementById("toast");
        x.innerText = msg;
        x.className = "show";
        setTimeout(function(){ x.className = x.className.replace("show", ""); }, 3000);
    }

    // 初始化
    updateLink();
</script>

</body>
</html>
    `;
}

// ==============================================================================
// 5. VLESS 协议解析 (保持稳定逻辑)
// ==============================================================================

async function vlessOverWSHandler(request, uuid) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    webSocket.accept();

    let address = '';
    let portWithRandomLog = '';
    const log = (info, event) => {
        console.log(\`[\${address}:\${portWithRandomLog}] \${info}\`, event || '');
    };
    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    let remoteSocketWapper = { value: null };
    let udpStreamWrite = null; 
    let isDns = false;

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

            const { hasError, message, port, addressType, host, rawDataIndex } = processVlessHeader(chunk, uuid);
            
            if (hasError) {
                throw new Error(message); 
            }

            address = host;
            portWithRandomLog = port;

            const remoteSocket = connect({ hostname: address, port: port });
            remoteSocketWapper.value = remoteSocket;

            const writer = remoteSocket.writable.getWriter();
            await writer.write(chunk.slice(rawDataIndex)); 
            writer.releaseLock();

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

    if (addressType === 1) { 
        addressLength = 4;
        addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
    } else if (addressType === 2) { 
        addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
        addressValueIndex += 1;
        addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
    } else if (addressType === 3) { 
        addressLength = 16;
        const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
        const ipv6 = [];
        for (let i = 0; i < 8; i++) { ipv6.push(dataView.getUint16(i * 2).toString(16)); }
        addressValue = ipv6.join(':');
    } else {
        return { hasError: true, message: \`invalid addressType: \${addressType}\` };
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
            log(\`ReadableStream was canceled, due to \${reason}\`);
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
