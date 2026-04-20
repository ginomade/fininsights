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
        const fmpKey = process.env.FMP_API_KEY;

        if (!fmpKey) {
            throw new Error("FMP_API_KEY no configurada en las variables de entorno de Netlify.");
        }

        // === 1. Obtener datos con Financial Modeling Prep ===
        const fmpRes = await fetch(
            `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${fmpKey}`
        );

        if (!fmpRes.ok) {
            throw new Error(`Error en FMP: ${fmpRes.status} - Verifica el símbolo o tu clave`);
        }

        const quotes = await fmpRes.json();
        const quote = quotes[0];

        if (!quote) {
            throw new Error("Acción no encontrada. Prueba con AAPL, TSLA, MELI, etc.");
        }

        const stockData = {
            symbol: quote.symbol,
            longName: quote.name || "N/A",
            price: quote.price,
            change: quote.change,
            changePercent: quote.changesPercentage,
            currency: "USD",   // FMP usa USD principalmente
            marketTime: new Date().toLocaleString('es-AR')
        };

        // === 2. Análisis con OpenAI (igual que antes) ===
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