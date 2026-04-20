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

        // === 1. Datos de Yahoo Finance (versión corregida con headers) ===
        const yahooRes = await fetch(
            `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`,
            {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
                    "Accept": "application/json",
                    "Referer": "https://finance.yahoo.com/"
                }
            }
        );

        if (!yahooRes.ok) {
            console.error(`Yahoo responded with ${yahooRes.status}`);
            throw new Error(`Yahoo Finance error: ${yahooRes.status} - Intenta más tarde o prueba otro símbolo`);
        }

        const yahooData = await yahooRes.json();
        const quote = yahooData.quoteResponse?.result?.[0];

        if (!quote) {
            throw new Error("Acción no encontrada. Verifica el símbolo (ej: AAPL, TSLA, MELI)");
        }

        const stockData = {
            symbol: quote.symbol,
            longName: quote.longName || quote.shortName || "N/A",
            price: quote.regularMarketPrice ?? quote.price,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            currency: quote.currency || "USD",
            marketTime: new Date().toLocaleString('es-AR')
        };

        // === 2. Análisis con OpenAI (sin cambios) ===
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey || !openaiKey.startsWith("sk-")) {
            throw new Error("Clave OpenAI no configurada correctamente.");
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

        if (!openaiRes.ok) {
            throw new Error("Error al conectar con OpenAI");
        }

        const openaiResult = await openaiRes.json();
        let content = openaiResult.choices[0].message.content.trim();

        // Limpiar JSON
        if (content.includes("```")) {
            content = content.split("```")[1].replace("json", "").trim();
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