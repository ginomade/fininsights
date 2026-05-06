// netlify/functions/analyze.js
export default async function handler(request, context) {
    // Solo permitimos peticiones POST
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Método no permitido" }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" } 
        });
    }

    try {
        const { ticker, license_key } = await request.json();

        // === 1. Validación de Entrada ===
        if (!ticker) {
            return new Response(JSON.stringify({ error: "Falta el símbolo de la acción" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json" } 
            });
        }

        if (!license_key) {
            return new Response(JSON.stringify({ error: "Se requiere una clave de licencia activa" }), { 
                status: 401, 
                headers: { "Content-Type": "application/json" } 
            });
        }

        // === 2. GUARDÍAN: Verificación con Gumroad ===
        const GUMROAD_PRODUCT_ID = process.env.GUMROAD_PRODUCT_ID; // Configúralo en las variables de entorno de Netlify
        
        const gumroadRes = await fetch("https://api.gumroad.com/v2/licenses/verify", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                product_id: GUMROAD_PRODUCT_ID,
                license_key: license_key,
                increment_uses_count: "true"
            })
        });

        const licenseData = await gumroadRes.json();

        if (!licenseData.success) {
            return new Response(JSON.stringify({ error: "Licencia inválida o expirada" }), { 
                status: 401, 
                headers: { "Content-Type": "application/json" } 
            });
        }

        // === 3. Obtención de Datos (Finnhub) ===
        const symbol = ticker.toUpperCase();
        const finnhubKey = process.env.FINNHUB_API_KEY;

        if (!finnhubKey) {
            throw new Error("FINNHUB_API_KEY no está configurada.");
        }

        const quoteRes = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`
        );
        if (!quoteRes.ok) throw new Error(`Error en Finnhub: ${quoteRes.status}`);

        const quote = await quoteRes.json();
        if (quote.c === 0 || !quote.c) {
            throw new Error("Acción no encontrada o sin datos.");
        }

        const profileRes = await fetch(
            `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${finnhubKey}`
        );
        const profile = profileRes.ok ? await profileRes.json() : {};

        const stockData = {
            symbol: symbol,
            longName: profile.name || symbol,
            price: quote.c,
            change: quote.d,
            changePercent: quote.dp,
            currency: quote.currency || "USD",
            marketTime: new Date().toLocaleString('es-AR'),
            sector: profile.finnhubIndustry || "N/A",
            marketCap: profile.marketCapitalization ? 
                (profile.marketCapitalization / 1000).toFixed(2) + "B" : "N/A"
        };

        // === 4. Análisis de IA (OpenAI) ===
        const openaiKey = process.env.OPENAI_API_KEY;
        const prompt = `Analiza la acción ${stockData.symbol} (${stockData.longName}). 
        Precio: ${stockData.price} ${stockData.currency}. Cambio: ${stockData.change}%. 
        Sector: ${stockData.sector}. Cap: ${stockData.marketCap}.
        Responde ÚNICAMENTE con un JSON: {"analisis": "texto corto", "recomendacion": "COMPRA|VENTA|MANTENER", "confianza": 60-100}`;

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3
            })
        });

        if (!openaiRes.ok) throw new Error("Error en OpenAI");

        const openaiResult = await openaiRes.json();
        let content = openaiResult.choices[0].message.content.trim();
        
        // Limpieza de formato markdown si existe
        if (content.includes("```")) {
            content = content.split("```")[1].replace(/json/gi, "").trim();
        }

        const aiAnalysis = JSON.parse(content);

        // Respuesta final exitosa
        return new Response(
            JSON.stringify({ success: true, stock: stockData, analysis: aiAnalysis }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Error:", error.message);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}