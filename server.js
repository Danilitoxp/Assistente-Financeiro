const express = require("express");
const { getFirestore } = require("firebase-admin/firestore");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const app = express();
const db = getFirestore();

app.get("/grafico", async (req, res) => {
    const despesasSnap = await db.collection("despesas").get();
    const despesas = despesasSnap.docs.map(doc => doc.data());

    const categorias = {};
    despesas.forEach(({ categoria, valor }) => {
        categorias[categoria] = (categorias[categoria] || 0) + valor;
    });

    const chart = new ChartJSNodeCanvas({ width: 800, height: 400 });
    const image = await chart.renderToBuffer({
        type: "bar",
        data: {
            labels: Object.keys(categorias),
            datasets: [{
                label: "Gastos por Categoria",
                data: Object.values(categorias),
            }],
        },
    });

    res.set("Content-Type", "image/png");
    res.send(image);
});

app.listen(3000, () => console.log("Servidor rodando na porta 3000"));
