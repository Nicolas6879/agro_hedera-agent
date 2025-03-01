const fetch = require('node-fetch');
require('dotenv').config();

// Función para procesar la consulta con OpenRouter
async function processQuery(query, context = {}) {
  try {
    console.log('Procesando consulta con OpenRouter...');
    
    // Detectar comandos de ayuda
    if (isHelpCommand(query)) {
      return generateHelpResponse();
    }
    
    // Detectar si es una solicitud para crear un registro
    const isRecordCreation = detectRecordCreation(query);
    
    // Verificar si tenemos registros disponibles en el contexto
    const hasRecords = context.records && context.records.length > 0;
    
    // Determinar si es una consulta sobre registros existentes
    const isRecordAnalysis = hasRecords && isRecordAnalysisQuery(query);
    
    // Construir el prompt adecuado basado en el tipo de consulta
    let systemPrompt = '';
    
    if (isRecordCreation) {
      systemPrompt = `Eres un asistente agrícola experto que ayuda a formatear registros agrícolas para almacenarlos en blockchain.
      
      El agricultor desea crear un registro con la siguiente información: "${query}"
      
      Extrae y formatea la información agrícola relevante en formato JSON estructurado con los siguientes campos:
      - activityType: tipo de actividad (siembra, cosecha, fertilización, riego, etc.)
      - description: descripción detallada de la actividad
      - location: ubicación donde se realizó (si se menciona)
      - crops: cultivos involucrados
      - date: fecha de la actividad (formateada como YYYY-MM-DD)
      - time: hora de la actividad (si se menciona)
      - notes: notas adicionales relevantes
      
      Solo devuelve el JSON formateado, sin explicaciones adicionales.`;
    } 
    else if (isRecordAnalysis) {
      // Preparar los registros para incluirlos en el contexto
      const formattedRecords = formatRecordsForAI(context.records);
      
      systemPrompt = `Eres un asistente agrícola experto que analiza registros agrícolas almacenados en blockchain.
      
      El agricultor ha realizado la siguiente consulta sobre sus registros: "${query}"
      
      A continuación se presentan los registros disponibles:
      ${formattedRecords}
      
      Analiza estos registros para responder a la consulta del agricultor. Puedes:
      - Proporcionar estadísticas y tendencias
      - Resumir actividades por tipo o cultivo
      - Identificar patrones o problemas
      - Sugerir mejoras en base a las prácticas observadas
      
      Responde de forma clara y concisa, organizando la información de manera útil para el agricultor.`;
    } 
    else {
      systemPrompt = `Eres un asistente agrícola experto que ayuda a los agricultores colombianos a mejorar sus prácticas agrícolas. 
      Ofrece respuestas concisas y prácticas sobre cultivos, técnicas agrícolas y gestión de fincas.
      Si la pregunta está relacionada con el registro o la consulta de datos de cultivos, 
      indícalo en tu respuesta sugiriendo el uso de la función de registro en la cadena de bloques Hedera.
      Recomienda buenas prácticas agrícolas sostenibles y enfócate en cultivos relevantes para Colombia.
      
      ${hasRecords ? 'El agricultor tiene registros almacenados en blockchain que puede consultar para análisis.' : ''}`;
    }
    
    // Puedes registrarte gratis en https://openrouter.ai/ para obtener una clave
    const apiKey = process.env.OPENROUTER_API_KEY || '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';
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
      },
      body: JSON.stringify({
        model: 'gryphe/mythomax-l2-13b', // Modelo más avanzado
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.error('Error de OpenRouter:', data.error);
      throw new Error(data.error.message || 'Error en OpenRouter');
    }
    
    console.log('Respuesta de OpenRouter obtenida con éxito.');
    
    // Procesar la respuesta según el tipo de consulta
    if (isRecordCreation) {
      try {
        // Intentar parsear el JSON de la respuesta
        const rawContent = data.choices[0].message.content.trim();
        // Eliminar cualquier markdown de código si existe
        const jsonContent = rawContent.replace(/```json|```/g, '').trim();
        const formattedRecord = JSON.parse(jsonContent);
        
        // Construir una respuesta amigable
        return {
          answer: `He formateado tu registro con éxito. Los siguientes datos se almacenarán en la blockchain de Hedera:
          
Tipo de actividad: ${formattedRecord.activityType}
Descripción: ${formattedRecord.description}
Cultivos: ${formattedRecord.crops}
Fecha: ${formattedRecord.date}
${formattedRecord.time ? `Hora: ${formattedRecord.time}` : ''}
${formattedRecord.location ? `Ubicación: ${formattedRecord.location}` : ''}
${formattedRecord.notes ? `Notas adicionales: ${formattedRecord.notes}` : ''}`,
          createRecord: true,
          formattedRecord: formattedRecord
        };
      } catch (e) {
        console.error('Error al procesar el formato de registro:', e);
        return {
          answer: `No pude formatear correctamente tu registro. Por favor, proporciona los detalles de forma más clara, incluyendo qué actividad realizaste, qué cultivos estaban involucrados y cuándo ocurrió.`,
          createRecord: false
        };
      }
    } else if (isRecordAnalysis) {
      return {
        answer: data.choices[0].message.content,
        isRecordAnalysis: true
      };
    } else {
      return {
        answer: data.choices[0].message.content,
        needsBlockchainStorage: shouldStoreInBlockchain(query)
      };
    }
  } catch (error) {
    console.error('Error al procesar la consulta con OpenRouter:', error);
    throw error;
  }
}

// Formato de registros para incluir en el prompt AI
function formatRecordsForAI(records) {
  try {
    let formattedRecords = '';
    
    // Intentamos parsear y formatear cada registro
    records.forEach((record, index) => {
      try {
        const data = JSON.parse(record.contents);
        
        // Si es un registro formateado (tiene el campo record)
        if (data.record) {
          const r = data.record;
          formattedRecords += `Registro #${index + 1} (${new Date(data.timestamp).toLocaleDateString()}):
- Tipo: ${r.activityType}
- Descripción: ${r.description}
- Cultivos: ${r.crops}
- Fecha de actividad: ${r.date}
${r.time ? `- Hora: ${r.time}\n` : ''}
${r.location ? `- Ubicación: ${r.location}\n` : ''}
${r.notes ? `- Notas: ${r.notes}\n` : ''}
`;
        }
        // Si es un registro de consulta
        else if (data.query) {
          formattedRecords += `Consulta #${index + 1} (${new Date(data.timestamp).toLocaleDateString()}):
- Consulta: ${data.query}
- Tipo: ${data.type || 'Consulta general'}
`;
        }
      } catch (e) {
        // Si hay error al parsear, lo saltamos
        console.error(`Error al formatear registro #${index + 1}:`, e);
      }
    });
    
    return formattedRecords || 'No hay registros disponibles para analizar.';
  } catch (error) {
    console.error('Error al formatear registros para AI:', error);
    return 'Error al procesar los registros disponibles.';
  }
}

// Detectar si la consulta está relacionada con el análisis de registros existentes
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

// Detectar si la consulta es un comando de ayuda
function isHelpCommand(query) {
  const helpKeywords = ['ayuda', 'help', 'qué puedes hacer', 'que puedes hacer', 'comandos', 'funciones', 'capacidades'];
  return helpKeywords.some(keyword => query.toLowerCase().includes(keyword));
}

// Generar respuesta de ayuda
function generateHelpResponse() {
  return {
    answer: `# 🌱 AgroHedera - Asistente Agrícola con Blockchain

## ¿Qué puedo hacer por ti?

### 📝 Crear registros agrícolas
Puedes decirme que quieres crear un registro y describir la actividad. Por ejemplo:
- "Quiero registrar que hoy sembré maíz en la parcela norte"
- "Crea un registro de la cosecha de café que hice ayer"
- "Registra que apliqué fertilizante orgánico esta mañana"

### 💬 Consultas agrícolas
Puedo responder preguntas sobre:
- Técnicas de cultivo
- Manejo de plagas
- Fertilización
- Riego
- Cosecha
- Almacenamiento de productos

### 📊 Análisis de datos
Puedo analizar tus registros almacenados:
- "Muestra un resumen de mis registros de siembra"
- "¿Cuántas veces apliqué fertilizante este mes?"
- "Analiza mis patrones de riego"
- "Dame estadísticas sobre los cultivos registrados"

### 📊 Visualización de registros
Puedes ver todos tus registros guardados en la blockchain usando el botón "Cargar Registros".

### 🔗 Gestión de topics de Hedera
Tus registros se guardan en un topic de Hedera:
- Puedes usar uno existente o crear uno nuevo
- Toda la información importante se guarda de forma segura en la blockchain de Hedera

Los datos almacenados en blockchain garantizan la trazabilidad e inmutabilidad de tus registros agrícolas.`,
    isHelp: true
  };
}

// Detectar si la consulta es para crear un registro
function detectRecordCreation(query) {
  const recordKeywords = [
    'crear registro', 'crear un registro', 'registrar', 'anotar', 'guardar', 
    'almacenar', 'tomar nota', 'documentar', 'apuntar'
  ];
  return recordKeywords.some(keyword => query.toLowerCase().includes(keyword));
}

// Función para determinar si la consulta debería requerir almacenamiento en blockchain
function shouldStoreInBlockchain(query) {
  const storageKeywords = ['registrar', 'guardar', 'almacenar', 'anotar', 'documentar', 'cosecha', 'siembra', 'fertilización', 'riego', 'cultivo'];
  return storageKeywords.some(keyword => query.toLowerCase().includes(keyword));
}

module.exports = {
  processQuery
};