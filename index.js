const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
require("dotenv").config();
const fetch = require("node-fetch");

// 🔥 Configuração do Firebase
const serviceAccount = require("./serviceAccountKey.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// 🔥 Chamar IA para interpretar despesas
async function analisarTextoComIA(texto) {
    console.log("🤖 Enviando mensagem para IA:", `"${texto}"`);

    try {
        const response = await fetch("https://api-inference.huggingface.co/models/facebook/bart-large-mnli", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: texto,
                parameters: { candidate_labels: ["despesa", "pergunta", "outro"] }
            }),
        });

        const jsonResponse = await response.json();
        console.log("📩 Resposta da IA:", jsonResponse);

        const categoriaMaisProvavel = jsonResponse.labels[0];
        return categoriaMaisProvavel;
    } catch (error) {
        console.error("❌ Erro ao acessar IA:", error);
        return "outro"; // Se a IA falhar, assume que não é despesa
    }
}

// 🔥 Interpretar mensagens como despesas automaticamente
function interpretarDespesa(texto) {
    console.log("🔍 Tentando interpretar:", `"${texto}"`);

    // Expressão regular para identificar despesas (ex: "mercado 50")
    const regex = /([a-zA-Zçãõáéíóú\s]+)\s+(\d+(?:[.,]\d{1,2})?)/i;
    const match = texto.match(regex);

    if (match) {
        const categoria = match[1].trim();
        const valor = parseFloat(match[2].replace(",", "."));

        console.log(`✅ Despesa detectada -> Categoria: "${categoria}", Valor: R$${valor}`);
        return { categoria, valor };
    }

    console.log("❌ Nenhuma despesa reconhecida.");
    return null;
}

// 🔗 Conexão com o WhatsApp
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === "close") connectToWhatsApp();
        if (connection === "open") console.log("✅ Conectado ao WhatsApp!");
    });

    return sock;
}

// 🚀 Iniciar o bot e processar mensagens
async function startBot() {
    const sock = await connectToWhatsApp();

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        text = text.toLowerCase().trim();

        console.log("📢 Mensagem recebida:", `"${text}"`);

        // 🔥 Testa se a mensagem pode ser interpretada como despesa
        let despesa = interpretarDespesa(text);
        if (!despesa) {
            const tipoMensagem = await analisarTextoComIA(text);
            if (tipoMensagem === "despesa") {
                despesa = interpretarDespesa(text); // Tenta interpretar de novo
            }
        }

        if (despesa) {
            await db.collection("despesas").add({ valor: despesa.valor, categoria: despesa.categoria, data: new Date() });
            await sock.sendMessage(chatId, { text: `✅ Despesa de *R$${despesa.valor}* em *${despesa.categoria}* adicionada!` });
            return;
        }

        // 📜 LISTAR DESPESAS
        if (text === "listar despesas" || text === "quais as minhas despesas") {
            const snapshot = await db.collection("despesas").get();
            if (snapshot.empty) {
                await sock.sendMessage(chatId, { text: "⚠️ Nenhuma despesa encontrada!" });
            } else {
                let resposta = "📌 *Suas despesas:*\n";
                snapshot.forEach(doc => {
                    const { valor, categoria, data } = doc.data();
                    resposta += `💸 *R$${valor}* - ${categoria} (${new Date(data._seconds * 1000).toLocaleDateString()})\n`;
                });
                await sock.sendMessage(chatId, { text: resposta });
            }
            return;
        }

        // 📊 RELATÓRIO DE GASTOS
        if (text === "total" || text === "relatorio financeiro") {
            const despesasSnapshot = await db.collection("despesas").get();
            let total = 0;
            despesasSnapshot.forEach(doc => {
                total += doc.data().valor;
            });

            await sock.sendMessage(chatId, { text: `📊 Seu total de despesas: *R$${total}*` });
            return;
        }

        // 🔍 Log de mensagem não reconhecida
        console.log("🔍 Não foi possível interpretar a mensagem.");
        await sock.sendMessage(chatId, { text: "🤖 Não entendi. Tente adicionar uma despesa ou pedir um relatório!" });
    });
}

// 🚀 Iniciar o bot
startBot().catch(err => console.error("Erro ao iniciar o bot:", err));
