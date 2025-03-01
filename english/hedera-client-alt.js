const { 
  Client, 
  TopicCreateTransaction, 
  TopicMessageSubmitTransaction,
  AccountId,
  PrivateKey
} = require("@hashgraph/sdk");
const fetch = require('node-fetch');
require('dotenv').config();

// Default credentials from .env
const defaultAccountId = process.env.HEDERA_ACCOUNT_ID;
const defaultPrivateKey = process.env.HEDERA_PRIVATE_KEY;

/**
 * Create a Hedera client for a specific account
 * @param {string} accountId - Hedera account ID
 * @param {string} privateKey - Private key for the account
 * @returns {Client} Configured Hedera client
 * @throws {Error} If client creation fails
 */
function createClient(accountId, privateKey) {
  try {
    const client = Client.forTestnet();
    client.setOperator(accountId, privateKey);
    return client;
  } catch (error) {
    console.error('Hedera client creation error:', error);
    throw new Error('Unable to create Hedera client. Verify your credentials.');
  }
}

/**
 * Verify Hedera account credentials
 * @param {string} accountId - Hedera account ID
 * @param {string} privateKey - Private key for the account
 * @returns {Promise<Object>} Verification result
 */
async function verifyCredentials(accountId, privateKey) {
  try {
    // Validate AccountId format
    if (!accountId || !AccountId.fromString(accountId)) {
      return { success: false, error: 'Invalid account ID' };
    }
    
    // Validate private key presence
    if (!privateKey) {
      return { success: false, error: 'Private key required' };
    }
    
    try {
      PrivateKey.fromString(privateKey);
    } catch (e) {
      return { success: false, error: 'Invalid private key format' };
    }
    
    // Attempt to create a client to test connection
    const client = createClient(accountId, privateKey);
    
    // Basic account verification using Mirror Node
    const accountQuery = new Promise((resolve, reject) => {
      // Timeout to prevent excessive waiting
      setTimeout(() => reject(new Error('Connection timeout')), 15000);
      
      // Fetch account information
      fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`)
        .then(response => {
          if (!response.ok) throw new Error('Unable to verify account');
          return response.json();
        })
        .then(data => resolve(data))
        .catch(error => reject(error));
    });
    
    await accountQuery;
    
    return { success: true };
  } catch (error) {
    console.error('Credential verification error:', error);
    return { 
      success: false, 
      error: error.message || 'Unknown error verifying credentials'
    };
  }
}

/**
 * Retrieve topics associated with a specific account
 * @param {string} accountId - Hedera account ID
 * @param {string} [currentTopicId=null] - Currently active topic ID
 * @returns {Promise<Array>} List of associated topics
 */
async function getUserTopics(accountId, currentTopicId = null) {
  try {
    const accountIdStr = accountId.toString();
    console.log(`Searching for topics created by account: ${accountIdStr}`);
    
    // Storage for found topics
    const userTopics = [];
    const uniqueTopicIds = new Set();
    
    // 1. Retrieve all account transactions
    try {
      const txUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${accountIdStr}&limit=100`;
      console.log(`Querying account transactions: ${txUrl}`);
      
      const txResponse = await fetch(txUrl);
      
      if (!txResponse.ok) {
        console.error(`Error querying transactions: ${txResponse.statusText}`);
      } else {
        const txData = await txResponse.json();
        console.log(`Found ${txData.transactions?.length || 0} transactions`);
        
        // Filter transactions by type
        if (txData.transactions && txData.transactions.length > 0) {
          // Iterate through transactions to find topic creations and messages
          for (const tx of txData.transactions) {
            if (tx.name === "CONSENSUSCREATETOPIC" && tx.entity_id) {
              console.log(`✓ Topic created: ${tx.entity_id}`);
              uniqueTopicIds.add(tx.entity_id);
            } 
            else if (tx.name === "CONSENSUSSUBMITMESSAGE" && tx.entity_id) {
              console.log(`✓ Topic with message: ${tx.entity_id}`);
              uniqueTopicIds.add(tx.entity_id);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error querying transactions:', error);
    }
    
    // 2. Fallback to specific transaction type if no topics found
    if (uniqueTopicIds.size === 0) {
      try {
        // Specifically query topic creation transactions
        const createUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${accountIdStr}&type=consensuscreatetopic&limit=25`;
        console.log(`Attempting specific transaction query: ${createUrl}`);
        
        const createResponse = await fetch(createUrl);
        
        if (createResponse.ok) {
          const createData = await createResponse.json();
          console.log(`Found ${createData.transactions?.length || 0} creation transactions`);
          
          if (createData.transactions && createData.transactions.length > 0) {
            for (const tx of createData.transactions) {
              if (tx.entity_id) {
                console.log(`✓ Topic created: ${tx.entity_id}`);
                uniqueTopicIds.add(tx.entity_id);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error querying creation transactions:', error);
      }
    }
    
    // 3. Check .env topic if no topics found and matching account
    if (uniqueTopicIds.size === 0 && accountIdStr === '0.0.5171369') {
      const envTopicId = '0.0.5637147';
      console.log(`Checking .env topic: ${envTopicId}`);
      
      try {
        const checkUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${envTopicId}`;
        const checkResponse = await fetch(checkUrl);
        
        if (checkResponse.ok) {
          console.log(`✓ Topic ${envTopicId} found and added`);
          uniqueTopicIds.add(envTopicId);
        }
      } catch (error) {
        console.error(`.env topic verification error:`, error);
      }
    }
    
    console.log(`Identified ${uniqueTopicIds.size} topics related to the account`);
    
    // 4. Retrieve details for each topic
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
          // Add basic info if detailed retrieval fails
          userTopics.push({
            topicId: topicId,
            memo: `Topic #${topicId}`,
            created: new Date().toISOString(),
            isCreatedByYou: true
          });
        }
      } catch (error) {
        console.error(`Error retrieving topic ${topicId} details:`, error);
        
        // Add basic topic info
        userTopics.push({
          topicId: topicId,
          memo: `Topic #${topicId}`,
          created: new Date().toISOString(),
          isCreatedByYou: true
        });
      }
    }
    
    // 5. Add current topic if exists and not already in list
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
              memo: topicDetails.memo || 'Current Topic',
              created: topicDetails.created_timestamp || new Date().toISOString(),
              isCurrent: true
            });
          } else {
            userTopics.unshift({
              topicId: currentTopicId,
              memo: 'Current Topic',
              created: new Date().toISOString(),
              isCurrent: true
            });
          }
        } catch (error) {
          userTopics.unshift({
            topicId: currentTopicId,
            memo: 'Current Topic',
            created: new Date().toISOString(),
            isCurrent: true
          });
        }
      }
    }
    
    console.log(`Returning ${userTopics.length} topics linked to account ${accountIdStr}`);
    return userTopics;
  } catch (error) {
    console.error('Error retrieving user topics:', error);
    
    // Return current topic if general error occurs
    if (currentTopicId) {
      return [{
        topicId: currentTopicId,
        memo: 'Current Topic',
        created: new Date().toISOString(),
        isCurrent: true
      }];
    }
    return [];
  }
}

/**
 * Create a new Hedera topic
 * @param {string} memo - Topic description/memo
 * @param {string} [accountId] - Account creating the topic
 * @param {string} [privateKey] - Private key for the account
 * @returns {Promise<string>} Created topic ID
 */
async function createTopic(memo, accountId, privateKey) {
  // Use provided or default credentials
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
  console.log(`Topic created with ID: ${topicId}`);
  return topicId.toString();
}

/**
 * Submit a message to a Hedera topic
 * @param {string} topicId - ID of the topic
 * @param {string} message - Message to submit
 * @param {string} [accountId] - Account submitting the message
 * @param {string} [privateKey] - Private key for the account
 * @returns {Promise<string>} Message submission status
 */
async function submitMessage(topicId, message, accountId, privateKey) {
  // Use provided or default credentials
  const client = accountId && privateKey 
    ? createClient(accountId, privateKey) 
    : createClient(defaultAccountId, defaultPrivateKey);
  
  const transaction = await new TopicMessageSubmitTransaction({
    topicId: topicId,
    message: message,
  }).execute(client);

  const receipt = await transaction.getReceipt(client);
  console.log(`Message sent to topic ${topicId}, status: ${receipt.status}`);
  return receipt.status.toString();
}

/**
 * Retrieve messages from a Hedera topic
 * @param {string} topicId - ID of the topic
 * @param {number} [limit=100] - Maximum number of messages to retrieve
 * @returns {Promise<Array>} List of messages
 */
async function getMessages(topicId, limit = 100) {
  try {
    console.log(`Retrieving messages for topic: ${topicId}`);
    
    // Format topicId for Mirror Node API
    const [shard, realm, num] = topicId.toString().split('.');
    
    // Construct URL to query topic messages
    const url = `https://testnet.mirrornode.hedera.com/api/v1/topics/${shard}.${realm}.${num}/messages?limit=${limit}`;
    
    console.log(`Querying URL: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror Node API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Response received with ${data.messages?.length || 0} messages`);
    
    // Transform messages to expected format
    const messages = (data.messages || []).map(message => ({
      timestamp: message.consensus_timestamp,
      contents: Buffer.from(message.message, 'base64').toString('utf8')
    }));
    
    return messages;
  } catch (error) {
    console.error(`Error retrieving messages: ${error}`);
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