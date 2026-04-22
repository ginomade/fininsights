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

        // === 1. Datos de precio (Quote) ===
        const quoteRes = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`
        );
        if (!quoteRes.ok) throw new Error(`Error en Finnhub Quote: ${quoteRes.status}`);

        const quote = await quoteRes.json();

        if (quote.c === 0 || !quote.c) {
            throw new Error("Acción no encontrada o sin datos recientes.");
        }

        // === 2. Perfil completo de la empresa (Profile2) ===
        const profileRes = await fetch(
            `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${finnhubKey}`
        );
        const profile = profileRes.ok ? await profileRes.json() : {};

        // Datos combinados
        const stockData = {
            symbol: symbol,
            longName: profile.name || symbol,
            price: quote.c,
            change: quote.d,
            changePercent: quote.dp,
            currency: quote.currency || "USD",
            marketTime: new Date().toLocaleString('es-AR'),
            // Datos adicionales para análisis profundo
            sector: profile.finnhubIndustry || profile.industry || "N/A",
            industry: profile.industry || "N/A",
            marketCap: profile.marketCapitalization ? 
                (profile.marketCapitalization / 1000000000).toFixed(2) + "B" : "N/A",
            country: profile.country || "N/A",
            exchange: profile.exchange || "N/A"
        };

        // === 3. Prompt MÁS PROFUNDO ===
        const prompt = `Eres un analista financiero senior con más de 20 años de experiencia en mercados globales, gestor de fondos y experto en valoración de acciones.

Datos actuales de la acción ${stockData.symbol}:

- Empresa: ${stockData.longName}
- Sector: ${stockData.sector} | Industria: ${stockData.industry}
- País: ${stockData.country} | Bolsa: ${stockData.exchange}
- Capitalización de mercado: ${stockData.marketCap}
- Precio actual: ${stockData.price} ${stockData.currency}
- Cambio diario: ${stockData.change} (${stockData.changePercent?.toFixed(2) || 'N/A'}%)

Realiza un **análisis profundo pero conciso**:
- Evalúa si el precio actual está **subvalorado** (oportunidad de COMPRA), **sobrevalorado** (VENTA) o en zona neutral (MANTENER).
- Considera: momentum del día, posible sobre-reacción del mercado, contexto sectorial, capitalización, y si el movimiento parece justificado.
- Ten en cuenta riesgo/recompensa y posibles catalizadores a corto plazo.

Sé objetivo, profesional y equilibrado. 

Responde **ÚNICAMENTE** con un JSON válido y nada más (sin texto adicional, sin markdown):

{
  "analisis": "máximo 4 oraciones claras y profesionales",
  "recomendacion": "COMPRA | VENTA | MANTENER",
  "confianza": número entero entre 60 y 100
}`;

        // === 4. Llamada a OpenAI ===
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey || !openaiKey.startsWith("sk-")) {
            throw new Error("OPENAI_API_KEY no configurada correctamente.");
        }

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 400
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