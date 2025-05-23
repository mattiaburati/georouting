/**
 * Cloudflare Worker per il routing geografico RTMP
 * Questo script indirizza automaticamente gli utenti al server RTMP più vicino
 * basandosi sulla loro posizione geografica.
 */

// Configurazione dei server RTMP regionali
const RTMP_SERVERS = {
  // Server attualmente attivi
  europe: 'eu.streammy.io',
  
  // Server previsti in futuro (attualmente reindirizzati a Europe)
  americas: 'eu.streammy.io', // Verrà aggiornato a 'am.streammy.io' quando disponibile
  asia: 'eu.streammy.io',     // Verrà aggiornato a 'as.streammy.io' quando disponibile
  
  // Fallback se la regione non è riconosciuta
  default: 'eu.streammy.io'
};

// Mappatura dei continenti alle regioni dei server
const CONTINENT_TO_REGION = {
  EU: 'europe',   // Europa
  NA: 'americas', // Nord America
  SA: 'americas', // Sud America
  AS: 'asia',     // Asia
  OC: 'asia',     // Oceania (uso il server asiatico)
  AF: 'europe',   // Africa (uso il server europeo per prossimità)
  AN: 'europe',   // Antartide (improbabile, ma usiamo Europa come fallback)
};

// Mappatura dei codici paese alle regioni (override per paesi specifici)
const COUNTRY_OVERRIDES = {
  // Esempi di override specifici per paese
  'RU': 'europe', // Russia - posizionata tra Europa e Asia
  'TR': 'europe', // Turchia - posizionata tra Europa e Asia
  'EG': 'europe', // Egitto - potrebbe avere connessioni migliori con Europa
  'AU': 'asia',   // Australia - usa il server asiatico
  'NZ': 'asia',   // Nuova Zelanda - usa il server asiatico
};

/**
 * Funzione per determinare il server RTMP più appropriato
 * @param {Request} request - La richiesta HTTP 
 * @returns {string} - L'hostname del server RTMP da utilizzare
 */
function determineClosestServer(request) {
  // Estrai le informazioni di geolocalizzazione dalla richiesta
  const cf = request.cf;
  
  // Se non abbiamo informazioni CF, usa il server di default
  if (!cf) {
    return RTMP_SERVERS.default;
  }
  
  // Controlla prima se esiste un override specifico per il paese
  if (cf.country && COUNTRY_OVERRIDES[cf.country]) {
    const region = COUNTRY_OVERRIDES[cf.country];
    return RTMP_SERVERS[region];
  }
  
  // Altrimenti usa la mappatura per continente
  if (cf.continent && CONTINENT_TO_REGION[cf.continent]) {
    const region = CONTINENT_TO_REGION[cf.continent];
    return RTMP_SERVERS[region];
  }
  
  // Fallback al server di default
  return RTMP_SERVERS.default;
}

/**
 * Gestisce le richieste per il routing RTMP
 */
async function handleRequest(request) {
  // Ottieni l'URL richiesto
  const url = new URL(request.url);
  const hostname = url.hostname;
  
  // Crea un oggetto per i log
  const logData = {
    timestamp: new Date().toISOString(),
    url: request.url,
    hostname: hostname,
    clientIP: request.headers.get('cf-connecting-ip') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    country: request.cf?.country || 'unknown',
    continent: request.cf?.continent || 'unknown',
    region: request.cf?.region || 'unknown',
  };
  
  // Se non è una richiesta per live.streammy.io, passa la richiesta senza modifiche
  if (hostname !== 'live.streammy.io') {
    console.log(`[NON-TARGET] Request for ${hostname}`, logData);
    return fetch(request);
  }
  
  // Determina il server più vicino
  const closestServer = determineClosestServer(request);
  
  // Aggiungi info sul server scelto ai log
  logData.selectedServer = closestServer;
  logData.serverRegion = closestServer.split('.')[0];
  
  // Log dettagliato della decisione di routing
  console.log(`[GEO-ROUTING] Redirecting to ${closestServer}`, logData);
  
  // Crea l'URL di destinazione
  const targetUrl = `https://${closestServer}${url.pathname}${url.search}`;
  
  // Crea una risposta di redirect
  const response = new Response(null, {
    status: 302,
    headers: {
      'Location': targetUrl,
      'Cache-Control': 'no-cache',
      'X-Streammy-Region': logData.serverRegion, // Aggiungi l'info della regione nelle intestazioni
      'X-Streammy-Country': logData.country,     // Aggiunge il paese rilevato
      'X-Streammy-Continent': logData.continent  // Aggiunge il continente rilevato
    }
  });
  
  return response;
}

// Esporta l'oggetto default come richiesto dal formato modulo ES di Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    try {
      // Misura il tempo di risposta
      const startTime = Date.now();
      
      // Esegui la richiesta
      const response = await handleRequest(request);
      
      // Calcola il tempo di risposta
      const responseTime = Date.now() - startTime;
      
      // Log delle performance
      console.log(`[PERFORMANCE] Request processed in ${responseTime}ms`);
      
      return response;
    } catch (error) {
      // Log degli errori
      console.error(`[ERROR] ${error.message}`, {
        stack: error.stack,
        url: request.url,
        method: request.method
      });
      
      // Restituisci una risposta di errore
      return new Response(`Internal Server Error: ${error.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  },
};
