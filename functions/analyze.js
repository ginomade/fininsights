// netlify/functions/analyze.js
export default async function handler(request, context) {
    // Solo permitimos POST
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

        // === 1. Obtener datos de Yahoo Finance (público) ===
        const yahooRes = await fetch(
            `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker.toUpperCase()}`
        );

        if (!yahooRes.ok) throw new Error("Error al obtener datos de Yahoo Finance");

        const yahooData = await yahooRes.json();
        const quote = yahooData.quoteResponse.result[0];

        if (!quote) throw new Error("Acción no encontrada");

        const stockData = {
            symbol: quote.symbol,
            longName: quote.longName || quote.shortName || "N/A",
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            currency: quote.currency || "USD",
            marketTime: new Date().toLocaleString('es-AR')
        };

        // === 2. Análisis con OpenAI (clave segura en servidor) ===
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            throw new Error("Clave de OpenAI no configurada en Netlify");
        }

        const prompt = `Eres un analista financiero profesional y directo.

Datos actuales de la acción ${stockData.symbol}:
- Precio: ${stockData.price} ${stockData.currency}
- Cambio: ${stockData.change} (${stockData.changePercent.toFixed(2)}%)
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

        if (!openaiRes.ok) {
            const err = await openaiRes.text();
            throw new Error("Error en OpenAI: " + err);
        }

        const openaiResult = await openaiRes.json();
        let content = openaiResult.choices[0].message.content.trim();

        // Limpiar posible markdown
        if (content.includes("```json")) content = content.split("```json")[1].split("```")[0];
        if (content.includes("```")) content = content.split("```")[1];

        const aiAnalysis = JSON.parse(content);

        return new Response(JSON.stringify({
            success: true,
            stock: stockData,
            analysis: aiAnalysis
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ 
            success: false, 
            error: error.message 
        }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}