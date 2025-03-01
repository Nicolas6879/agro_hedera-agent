const express = require('express');
const cors = require('cors');
const { verifyCredentials, getUserTopics, createTopic, submitMessage, getMessages } = require('./hedera-client-alt');
const { processQuery } = require('./ai-agent');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Almacena el ID del tema (esto sería mejor en una base de datos)
let currentTopicId = null;

// Ruta para verificar y conectar wallet
app.post('/api/connect-wallet', async (req, res) => {
  try {
    const { accountId, privateKey } = req.body;
    
    if (!accountId || !privateKey) {
      return res.status(400).json({ 
        success: false, 
        error: "Es necesario proporcionar un ID de cuenta y clave privada" 
      });
    }
    
    // Verificar las credenciales
    const verification = await verifyCredentials(accountId, privateKey);
    
    if (!verification.success) {
      return res.status(400).json({ 
        success: false, 
        error: verification.error || "Credenciales inválidas" 
      });
    }
    
    console.log(`Wallet conectada para la cuenta: ${accountId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al conectar wallet:', error);
    res.status(500).json({ 
      success: false, 
      error: "Error interno al verificar las credenciales" 
    });
  }
});

// Ruta para obtener los topics del usuario
app.post('/api/user-topics', async (req, res) => {
  try {
    const { accountId, privateKey } = req.body;
    
    if (!accountId) {
      return res.status(400).json({ 
        success: false, 
        error: "Es necesario proporcionar un ID de cuenta" 
      });
    }
    
    // Pasar el currentTopicId al getUserTopics para que pueda añadirlo a la lista si existe
    const topics = await getUserTopics(accountId, currentTopicId);
    res.json({ success: true, topics });
  } catch (error) {
    console.error('Error al obtener topics del usuario:', error);
    res.status(500).json({ 
      success: false, 
      error: "Error al obtener los topics: " + error.message 
    });
  }
});

// Ruta para establecer el tema por ID
app.post('/api/set-topic', async (req, res) => {
  try {
    const { topicId, accountId, privateKey } = req.body;
    
    if (!topicId || topicId.trim() === '') {
      return res.status(400).json({ error: "Es necesario proporcionar un ID de tema válido" });
    }
    
    currentTopicId = topicId.trim();
    console.log(`Tema establecido manualmente: ${currentTopicId}`);
    res.json({ success: true, topicId: currentTopicId });
  } catch (error) {
    console.error('Error al establecer el tema:', error);
    res.status(500).json({ error: "Error interno al establecer el tema" });
  }
});

// Ruta para crear un nuevo tema
app.post('/api/create-topic', async (req, res) => {
  try {
    const { memo, accountId, privateKey } = req.body;
    const topicMemo = memo || "AgroConsultas";
    
    const topicId = await createTopic(topicMemo, accountId, privateKey);
    currentTopicId = topicId;
    console.log(`Nuevo tema creado: ${currentTopicId}`);
    res.json({ success: true, topicId: currentTopicId });
  } catch (error) {
    console.error('Error al crear el tema:', error);
    res.status(500).json({ error: "Error interno al crear el tema" });
  }
});

// Ruta para obtener el ID del tema actual
app.get('/api/current-topic', (req, res) => {
  if (currentTopicId) {
    res.json({ topicId: currentTopicId });
  } else {
    res.status(404).json({ error: "No hay un tema establecido" });
  }
});

// Ruta para consultas al agente
app.post('/api/query', async (req, res) => {
  try {
    const { query, accountId, privateKey } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "Es necesario proporcionar una consulta" });
    }
    
    // Preparar contexto con registros si es necesario para análisis
    let context = { currentTopicId };
    
    // Si la consulta parece ser sobre análisis de registros y tenemos un topic,
    // obtenemos los registros para incluirlos en el contexto
    if (currentTopicId && isRecordAnalysisQuery(query)) {
      try {
        console.log("Obteniendo registros para análisis...");
        const records = await getMessages(currentTopicId);
        context.records = records;
        console.log(`${records.length} registros obtenidos para análisis`);
      } catch (recordError) {
        console.error("Error al obtener registros para análisis:", recordError);
        // Continuamos sin registros si hay error
      }
    }
    
    try {
      // Procesar la consulta con el agente de IA
      const result = await processQuery(query, context);
      
      // Si la consulta es para crear un registro y tenemos un topicId
      if (result.createRecord && currentTopicId) {
        const message = JSON.stringify({
          record: result.formattedRecord,
          timestamp: new Date().toISOString(),
          type: 'farm_record'
        });
        
        await submitMessage(currentTopicId, message, accountId, privateKey);
        result.storedInBlockchain = true;
        result.topicId = currentTopicId;
      } 
      // Si la consulta debería almacenarse en la blockchain y tenemos un topicId
      else if (result.needsBlockchainStorage && currentTopicId) {
        const message = JSON.stringify({
          query,
          timestamp: new Date().toISOString(),
          type: 'farm_query'
        });
        
        await submitMessage(currentTopicId, message, accountId, privateKey);
        result.storedInBlockchain = true;
        result.topicId = currentTopicId;
      }
      // Si necesitamos blockchain pero no tenemos topic
      else if ((result.needsBlockchainStorage || result.createRecord) && !currentTopicId) {
        result.noTopicAvailable = true;
      }
      
      res.json(result);
    } catch (aiError) {
      console.error('Error con el servicio de IA:', aiError);
      // Informar al cliente sobre el problema específico
      res.status(503).json({ 
        error: "Servicio de IA temporalmente no disponible. Por favor, inténtalo de nuevo.",
        details: aiError.message 
      });
    }
  } catch (error) {
    console.error('Error al procesar la consulta:', error);
    res.status(500).json({ error: "Error interno al procesar la consulta" });
  }
});

// Función para detectar consultas relacionadas con análisis de registros
function isRecordAnalysisQuery(query) {
  const analysisKeywords = [
    'analiza', 'analizar', 'resumen', 'resumir', 'estadísticas', 'estadística',
    'tendencia', 'tendencias', 'patrones', 'patrón', 'historial', 'historia',
    'registros', 'registro', 'datos', 'dato', 'información', 'comparar',
    'comparación', 'evaluar', 'evaluación', 'reportar', 'reporte',
    'mostrar mis', 'ver mis', 'cuándo', 'cuando', 'cuántas veces', 'cuantas veces',
    'qué he', 'que he', 'cuál es', 'cual es', 'dime si', 'cuánto', 'cuanto'
  ];
  
  return analysisKeywords.some(keyword => 
    query.toLowerCase().includes(keyword)
  );
}

// Ruta para obtener registros
app.post('/api/records', async (req, res) => {
  try {
    const { topicId, accountId, privateKey } = req.body;
    const requestedTopicId = topicId || currentTopicId;
    
    if (!requestedTopicId) {
      return res.status(404).json({ error: "No hay un tema inicializado todavía" });
    }
    
    const records = await getMessages(requestedTopicId);
    res.json(records);
  } catch (error) {
    console.error('Error al obtener registros:', error);
    res.status(500).json({ error: "Error interno al obtener registros" });
  }
});

// Inicializar y comenzar el servidor
const PORT = process.env.PORT || 3200;
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});