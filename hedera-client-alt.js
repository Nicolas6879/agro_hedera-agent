const { 
  Client, 
  TopicCreateTransaction, 
  TopicMessageSubmitTransaction,
  AccountId,
  PrivateKey
} = require("@hashgraph/sdk");
const fetch = require('node-fetch');
require('dotenv').config();

// Credenciales por defecto desde .env
const defaultAccountId = process.env.HEDERA_ACCOUNT_ID;
const defaultPrivateKey = process.env.HEDERA_PRIVATE_KEY;

// Crear un cliente para un usuario específico
function createClient(accountId, privateKey) {
  try {
    const client = Client.forTestnet();
    client.setOperator(accountId, privateKey);
    return client;
  } catch (error) {
    console.error('Error al crear cliente Hedera:', error);
    throw new Error('No se pudo crear el cliente de Hedera. Verifica tus credenciales.');
  }
}

// Verificar credenciales de Hedera
async function verifyCredentials(accountId, privateKey) {
  try {
    // Verificar formato del AccountId
    if (!accountId || !AccountId.fromString(accountId)) {
      return { success: false, error: 'ID de cuenta inválido' };
    }
    
    // Verificar formato de la clave privada
    if (!privateKey) {
      return { success: false, error: 'Clave privada requerida' };
    }
    
    try {
      PrivateKey.fromString(privateKey);
    } catch (e) {
      return { success: false, error: 'Formato de clave privada inválido' };
    }
    
    // Intentar crear un cliente para probar la conexión
    const client = createClient(accountId, privateKey);
    
    // Una forma básica de verificar es consultar el saldo
    const accountQuery = new Promise((resolve, reject) => {
      // Timeout para evitar esperas excesivas
      setTimeout(() => reject(new Error('Tiempo de espera agotado')), 15000);
      
      // Intentar obtener información de la cuenta
      fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`)
        .then(response => {
          if (!response.ok) throw new Error('No se pudo verificar la cuenta');
          return response.json();
        })
        .then(data => resolve(data))
        .catch(error => reject(error));
    });
    
    await accountQuery;
    
    return { success: true };
  } catch (error) {
    console.error('Error al verificar credenciales:', error);
    return { 
      success: false, 
      error: error.message || 'Error desconocido al verificar credenciales'
    };
  }
}

// Obtener los topics vinculados a una cuenta específica (enfoque inverso)
async function getUserTopics(accountId, currentTopicId = null) {
  try {
    const accountIdStr = accountId.toString();
    console.log(`Buscando topics creados por la cuenta: ${accountIdStr} (enfoque inverso)`);
    
    // Lista para almacenar los topics encontrados
    const userTopics = [];
    const uniqueTopicIds = new Set();
    
    // 1. Obtener todas las transacciones de la cuenta
    try {
      const txUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${accountIdStr}&limit=100`;
      console.log(`Consultando transacciones de la cuenta: ${txUrl}`);
      
      const txResponse = await fetch(txUrl);
      
      if (!txResponse.ok) {
        console.error(`Error consultando transacciones: ${txResponse.statusText}`);
      } else {
        const txData = await txResponse.json();
        console.log(`Se encontraron ${txData.transactions?.length || 0} transacciones`);
        
        // Filtrar transacciones por tipo
        if (txData.transactions && txData.transactions.length > 0) {
          // Iterar sobre las transacciones buscando creaciones de topics y mensajes
          for (const tx of txData.transactions) {
            if (tx.name === "CONSENSUSCREATETOPIC" && tx.entity_id) {
              console.log(`✓ Topic creado: ${tx.entity_id}`);
              uniqueTopicIds.add(tx.entity_id);
            } 
            else if (tx.name === "CONSENSUSSUBMITMESSAGE" && tx.entity_id) {
              console.log(`✓ Topic con mensaje: ${tx.entity_id}`);
              uniqueTopicIds.add(tx.entity_id);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error al consultar transacciones:', error);
    }
    
    // 2. Si no encontramos nada, intentar el enfoque específico por tipo de transacción
    if (uniqueTopicIds.size === 0) {
      try {
        // Intentar específicamente con transacciones de creación de topics
        const createUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${accountIdStr}&type=consensuscreatetopic&limit=25`;
        console.log(`Intentando específicamente transacciones de creación: ${createUrl}`);
        
        const createResponse = await fetch(createUrl);
        
        if (createResponse.ok) {
          const createData = await createResponse.json();
          console.log(`Se encontraron ${createData.transactions?.length || 0} transacciones de creación`);
          
          if (createData.transactions && createData.transactions.length > 0) {
            for (const tx of createData.transactions) {
              if (tx.entity_id) {
                console.log(`✓ Topic creado: ${tx.entity_id}`);
                uniqueTopicIds.add(tx.entity_id);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error al consultar transacciones de creación:', error);
      }
    }
    
    // 3. Si seguimos sin encontrar nada, revisemos si tiene el topic que estaba en el .env
    if (uniqueTopicIds.size === 0 && accountIdStr === '0.0.5171369') {
      const envTopicId = '0.0.5637147';
      console.log(`Verificando si existe el topic del archivo .env: ${envTopicId}`);
      
      try {
        const checkUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${envTopicId}`;
        const checkResponse = await fetch(checkUrl);
        
        if (checkResponse.ok) {
          console.log(`✓ Topic ${envTopicId} encontrado y añadido`);
          uniqueTopicIds.add(envTopicId);
        }
      } catch (error) {
        console.error(`Error al verificar topic del .env:`, error);
      }
    }
    
    console.log(`Se identificaron ${uniqueTopicIds.size} topics relacionados con la cuenta`);
    
    // 4. Obtener detalles de cada topic encontrado
    for (const topicId of uniqueTopicIds) {
      try {
        const detailUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}`;
        const detailResponse = await fetch(detailUrl);
        
        if (detailResponse.ok) {
          const topicDetails = await detailResponse.json();
          
          userTopics.push({
            topicId: topicId,
            memo: topicDetails.memo || `Topic #${topicId}`,
            created: topicDetails.created_timestamp || new Date().toISOString(),
            isCreatedByYou: true
          });
        } else {
          // Si no podemos obtener detalles, añadir información básica
          userTopics.push({
            topicId: topicId,
            memo: `Topic #${topicId}`,
            created: new Date().toISOString(),
            isCreatedByYou: true
          });
        }
      } catch (error) {
        console.error(`Error al obtener detalles del topic ${topicId}:`, error);
        
        // Añadir con información básica
        userTopics.push({
          topicId: topicId,
          memo: `Topic #${topicId}`,
          created: new Date().toISOString(),
          isCreatedByYou: true
        });
      }
    }
    
    // 5. Añadir el topic actual si existe y no está ya en la lista
    if (currentTopicId) {
      const exists = userTopics.some(topic => topic.topicId === currentTopicId);
      
      if (!exists) {
        try {
          const currentTopicUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${currentTopicId}`;
          const currentTopicResponse = await fetch(currentTopicUrl);
          
          if (currentTopicResponse.ok) {
            const topicDetails = await currentTopicResponse.json();
            
            userTopics.unshift({
              topicId: currentTopicId,
              memo: topicDetails.memo || 'Topic Actual',
              created: topicDetails.created_timestamp || new Date().toISOString(),
              isCurrent: true
            });
          } else {
            userTopics.unshift({
              topicId: currentTopicId,
              memo: 'Topic Actual',
              created: new Date().toISOString(),
              isCurrent: true
            });
          }
        } catch (error) {
          userTopics.unshift({
            topicId: currentTopicId,
            memo: 'Topic Actual',
            created: new Date().toISOString(),
            isCurrent: true
          });
        }
      }
    }
    
    console.log(`Retornando ${userTopics.length} topics vinculados a la cuenta ${accountIdStr}`);
    return userTopics;
  } catch (error) {
    console.error('Error al obtener topics del usuario:', error);
    
    // Si ocurre un error general, al menos devolver el topic actual si existe
    if (currentTopicId) {
      return [{
        topicId: currentTopicId,
        memo: 'Topic Actual',
        created: new Date().toISOString(),
        isCurrent: true
      }];
    }
    return [];
  }
}

// Función para crear un nuevo tema (tópico)
async function createTopic(memo, accountId, privateKey) {
  // Si no se proporcionan credenciales, usar las predeterminadas
  const client = accountId && privateKey 
    ? createClient(accountId, privateKey) 
    : createClient(defaultAccountId, defaultPrivateKey);
  
  const transaction = await new TopicCreateTransaction()
    .setAdminKey(client.publicKey)
    .setSubmitKey(client.publicKey)
    .setTopicMemo(memo)
    .execute(client);

  const receipt = await transaction.getReceipt(client);
  const topicId = receipt.topicId;
  console.log(`Tema creado con ID: ${topicId}`);
  return topicId.toString();
}

// Función para enviar un mensaje a un tema
async function submitMessage(topicId, message, accountId, privateKey) {
  // Si no se proporcionan credenciales, usar las predeterminadas
  const client = accountId && privateKey 
    ? createClient(accountId, privateKey) 
    : createClient(defaultAccountId, defaultPrivateKey);
  
  const transaction = await new TopicMessageSubmitTransaction({
    topicId: topicId,
    message: message,
  }).execute(client);

  const receipt = await transaction.getReceipt(client);
  console.log(`Mensaje enviado al tema ${topicId}, estado: ${receipt.status}`);
  return receipt.status.toString();
}

// Función para consultar mensajes usando la API REST del Mirror Node
async function getMessages(topicId, limit = 100) {
  try {
    console.log(`Consultando mensajes para el tema: ${topicId}`);
    
    // Formato del topicId para la API del Mirror Node
    const [shard, realm, num] = topicId.toString().split('.');
    
    // Construcción de la URL para consultar los mensajes del tema
    const url = `https://testnet.mirrornode.hedera.com/api/v1/topics/${shard}.${realm}.${num}/messages?limit=${limit}`;
    
    console.log(`Consultando URL: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Error consultando la API del Mirror Node: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Respuesta recibida con ${data.messages?.length || 0} mensajes`);
    
    // Transformar los mensajes al formato esperado
    const messages = (data.messages || []).map(message => ({
      timestamp: message.consensus_timestamp,
      contents: Buffer.from(message.message, 'base64').toString('utf8')
    }));
    
    return messages;
  } catch (error) {
    console.error(`Error al consultar mensajes: ${error}`);
    throw error;
  }
}

module.exports = {
  createClient,
  verifyCredentials,
  getUserTopics,
  createTopic,
  submitMessage,
  getMessages
};