// netlify/functions/analyze.js
export default async function handler(request, context) {
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Método no permitido" }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" } 
        });
    }

    try {
        const { ticker } = await request.json();
        if (!ticker) {
            return new Response(JSON.stringify({ error: "Falta el símbolo de la acción" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json" } 
            });
        }

        const symbol = ticker.toUpperCase();
        const finnhubKey = process.env.FINNHUB_API_KEY;

        if (!finnhubKey) {
            throw new Error("FINNHUB_API_KEY no está configurada en Netlify.");
        }

        // === 1. Obtener datos de Finnhub ===
        const quoteRes = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`
        );

        if (!quoteRes.ok) {
            throw new Error(`Error en Finnhub: ${quoteRes.status}. Verifica el símbolo o tu clave.`);
        }

        const quote = await quoteRes.json();

        if (quote.c === 0 || !quote.c) {
            throw new Error("Acción no encontrada o sin datos recientes. Prueba AAPL, TSLA, MELI, etc.");
        }

        // Finnhub devuelve precio actual (c), cambio (d) y % (dp)
        const stockData = {
            symbol: symbol,
            longName: symbol, // Finnhub quote no devuelve nombre completo, usamos símbolo por ahora
            price: quote.c,
            change: quote.d,
            changePercent: quote.dp,
            currency: "USD",
            marketTime: new Date().toLocaleString('es-AR')
        };

        // === 2. Análisis con OpenAI ===
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey || !openaiKey.startsWith("sk-")) {
            throw new Error("OPENAI_API_KEY no configurada correctamente.");
        }

        const prompt = `Eres un analista financiero profesional y directo.

Datos actuales de la acción ${stockData.symbol}:
- Precio: ${stockData.price} ${stockData.currency}
- Cambio: ${stockData.change} (${stockData.changePercent?.toFixed(2) || 'N/A'}%)
- Empresa: ${stockData.longName}

Analiza brevemente si el precio actual está BAJO (subvalorado) o ALTO (sobrevalorado). 
Da una recomendación clara: COMPRA, VENTA o MANTENER.
Responde ÚNICAMENTE con un JSON válido:

{
  "analisis": "máximo 2 oraciones cortas y claras",
  "recomendacion": "COMPRA | VENTA | MANTENER",
  "confianza": número entre 60 y 100
}`;

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.4,
                max_tokens: 300
            })
        });

        if (!openaiRes.ok) throw new Error("Error al conectar con OpenAI");

        const openaiResult = await openaiRes.json();
        let content = openaiResult.choices[0].message.content.trim();

        if (content.includes("```")) {
            content = content.split("```")[1].replace(/json/gi, "").trim();
        }

        const aiAnalysis = JSON.parse(content);

        return new Response(
            JSON.stringify({ success: true, stock: stockData, analysis: aiAnalysis }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Error en la function:", error.message);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}