const express = require('express');
const cors = require('cors');
const { verifyCredentials, getUserTopics, createTopic, submitMessage, getMessages } = require('./hedera-client-alt');
const { processQuery } = require('./ai-agent');

// Initialize Express application
const app = express();

// Middleware configuration
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies
app.use(express.static('public')); // Serve static files from 'public' directory

// Global topic storage (Note: In production, use a database)
let currentTopicId = null;

/**
 * Wallet Connection API Endpoint
 * Verifies Hedera wallet credentials
 */
app.post('/api/connect-wallet', async (req, res) => {
  try {
    const { accountId, privateKey } = req.body;
    
    // Input validation
    if (!accountId || !privateKey) {
      return res.status(400).json({ 
        success: false, 
        error: "Account ID and Private Key are required" 
      });
    }
    
    // Verify Hedera credentials
    const verification = await verifyCredentials(accountId, privateKey);
    
    if (!verification.success) {
      return res.status(400).json({ 
        success: false, 
        error: verification.error || "Invalid credentials" 
      });
    }
    
    console.log(`Wallet connected for account: ${accountId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Wallet connection error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal error verifying credentials" 
    });
  }
});

/**
 * User Topics Retrieval API Endpoint
 * Fetches topics associated with a user's account
 */
app.post('/api/user-topics', async (req, res) => {
  try {
    const { accountId, privateKey } = req.body;
    
    if (!accountId) {
      return res.status(400).json({ 
        success: false, 
        error: "Account ID is required" 
      });
    }
    
    // Retrieve user topics, passing current topic for potential inclusion
    const topics = await getUserTopics(accountId, currentTopicId);
    res.json({ success: true, topics });
  } catch (error) {
    console.error('Error retrieving user topics:', error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to retrieve topics: " + error.message 
    });
  }
});

/**
 * Topic Selection API Endpoint
 * Manually sets a specific topic by ID
 */
app.post('/api/set-topic', async (req, res) => {
  try {
    const { topicId, accountId, privateKey } = req.body;
    
    if (!topicId || topicId.trim() === '') {
      return res.status(400).json({ error: "A valid topic ID is required" });
    }
    
    currentTopicId = topicId.trim();
    console.log(`Topic manually set: ${currentTopicId}`);
    res.json({ success: true, topicId: currentTopicId });
  } catch (error) {
    console.error('Topic setting error:', error);
    res.status(500).json({ error: "Internal error setting topic" });
  }
});

/**
 * Topic Creation API Endpoint
 * Creates a new Hedera topic
 */
app.post('/api/create-topic', async (req, res) => {
  try {
    const { memo, accountId, privateKey } = req.body;
    const topicMemo = memo || "AgroConsults";
    
    const topicId = await createTopic(topicMemo, accountId, privateKey);
    currentTopicId = topicId;
    console.log(`New topic created: ${currentTopicId}`);
    res.json({ success: true, topicId: currentTopicId });
  } catch (error) {
    console.error('Topic creation error:', error);
    res.status(500).json({ error: "Internal error creating topic" });
  }
});

/**
 * Current Topic Retrieval API Endpoint
 * Returns the currently active topic ID
 */
app.get('/api/current-topic', (req, res) => {
  if (currentTopicId) {
    res.json({ topicId: currentTopicId });
  } else {
    res.status(404).json({ error: "No topic has been set" });
  }
});

/**
 * Query Processing API Endpoint
 * Handles AI-powered agricultural queries and blockchain storage
 */
app.post('/api/query', async (req, res) => {
  try {
    const { query, accountId, privateKey } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "A query is required" });
    }
    
    // Prepare context with records for analysis
    let context = { currentTopicId };
    
    // Retrieve records for analysis if applicable
    if (currentTopicId && isRecordAnalysisQuery(query)) {
      try {
        console.log("Retrieving records for analysis...");
        const records = await getMessages(currentTopicId);
        context.records = records;
        console.log(`${records.length} records retrieved for analysis`);
      } catch (recordError) {
        console.error("Error retrieving records for analysis:", recordError);
        // Continue without records if error occurs
      }
    }
    
    try {
      // Process query with AI agent
      const result = await processQuery(query, context);
      
      // Handle record creation and blockchain storage
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
      // Notify if blockchain storage is needed but no topic is available
      else if ((result.needsBlockchainStorage || result.createRecord) && !currentTopicId) {
        result.noTopicAvailable = true;
      }
      
      res.json(result);
    } catch (aiError) {
      console.error('AI Service Error:', aiError);
      res.status(503).json({ 
        error: "AI service temporarily unavailable. Please try again.",
        details: aiError.message 
      });
    }
  } catch (error) {
    console.error('Query processing error:', error);
    res.status(500).json({ error: "Internal error processing query" });
  }
});

/**
 * Detect if a query is related to record analysis
 * @param {string} query - User's input query
 * @returns {boolean} Whether the query is an analysis request
 */
function isRecordAnalysisQuery(query) {
  const analysisKeywords = [
    'analyze', 'summary', 'statistics', 'trend', 'pattern', 
    'history', 'record', 'data', 'information', 'compare', 
    'evaluate', 'report', 'show my', 'view my', 'when', 
    'how many times', 'what have I', 'what is', 'tell me'
  ];
  
  return analysisKeywords.some(keyword => 
    query.toLowerCase().includes(keyword)
  );
}

/**
 * Records Retrieval API Endpoint
 * Fetches records from a specific or current topic
 */
app.post('/api/records', async (req, res) => {
  try {
    const { topicId, accountId, privateKey } = req.body;
    const requestedTopicId = topicId || currentTopicId;
    
    if (!requestedTopicId) {
      return res.status(404).json({ error: "No topic initialized yet" });
    }
    
    const records = await getMessages(requestedTopicId);
    res.json(records);
  } catch (error) {
    console.error('Error retrieving records:', error);
    res.status(500).json({ error: "Internal error retrieving records" });
  }
});

// Server initialization
const PORT = process.env.PORT || 3200;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
});