// netlify/functions/analyze.js
export default async function handler(request, context) {
    console.log("Function called with method:", request.method);

    if (request.method !== "POST") {
        return new Response(
            JSON.stringify({ error: "Método no permitido. Usa POST." }),
            { status: 405, headers: { "Content-Type": "application/json" } }
        );
    }

    try {
        const body = await request.json();
        const { ticker } = body;

        console.log("Ticker recibido:", ticker);

        if (!ticker || typeof ticker !== "string") {
            return new Response(
                JSON.stringify({ error: "Falta el símbolo de la acción (ticker)" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        // Verificar clave OpenAI
        const openaiKey = process.env.OPENAI_API_KEY;
        console.log("¿Clave OpenAI presente?", !!openaiKey);

        if (!openaiKey || !openaiKey.startsWith("sk-")) {
            throw new Error("La clave OPENAI_API_KEY no está configurada correctamente en Netlify Environment Variables.");
        }

        // 1. Datos de Yahoo Finance
        const yahooRes = await fetch(
            `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker.toUpperCase()}`
        );

        if (!yahooRes.ok) throw new Error(`Yahoo Finance error: ${yahooRes.status}`);

        const yahooData = await yahooRes.json();
        const quote = yahooData.quoteResponse?.result?.[0];

        if (!quote) throw new Error("Acción no encontrada en Yahoo Finance");

        const stockData = {
            symbol: quote.symbol,
            longName: quote.longName || quote.shortName || "N/A",
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            currency: quote.currency || "USD",
            marketTime: new Date().toLocaleString('es-AR')
        };

        // 2. Prompt para OpenAI
        const prompt = `Eres un analista financiero profesional y directo.

Datos actuales de la acción ${stockData.symbol}:
- Precio: ${stockData.price} ${stockData.currency}
- Cambio: ${stockData.change} (${stockData.changePercent.toFixed(2)}%)
- Empresa: ${stockData.longName}

Analiza brevemente si el precio actual está BAJO (subvalorado) o ALTO (sobrevalorado). 
Da una recomendación clara: COMPRA, VENTA o MANTENER.
Responde ÚNICAMENTE con un JSON válido y nada más:

{
  "analisis": "máximo 2 oraciones cortas y claras",
  "recomendacion": "COMPRA | VENTA | MANTENER",
  "confianza": número entre 60 y 100
}`;

        // 3. Llamada a OpenAI
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

        if (!openaiRes.ok) {
            const errText = await openaiRes.text();
            console.error("OpenAI error:", errText);
            throw new Error(`OpenAI error: ${openaiRes.status}`);
        }

        const openaiResult = await openaiRes.json();
        let content = openaiResult.choices[0].message.content.trim();

        // Limpiar posible código markdown
        if (content.includes("```json")) content = content.split("```json")[1].split("```")[0].trim();
        if (content.includes("```")) content = content.split("```")[1].trim();

        const aiAnalysis = JSON.parse(content);

        return new Response(
            JSON.stringify({ success: true, stock: stockData, analysis: aiAnalysis }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Error en la function:", error.message);
        return new Response(
            JSON.stringify({ 
                success: false, 
                error: error.message 
            }),
            { 
                status: 500, 
                headers: { "Content-Type": "application/json" } 
            }
        );
    }
}