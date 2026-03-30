const axios = require('axios');

async function testClassification() {
  const prompt = "Explain the Forge project and help me brainstorm some new features.";
  
  console.log('Testing Jarvis Intent Classification API...');
  console.log(`Prompt: "${prompt}"`);

  try {
    // Note: This requires the server to be running (npm start)
    // If Ollama is not running, the server will return a 500 error with details.
    const response = await axios.post('http://localhost:3001/api/classify', { prompt });
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error Details:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
      console.log('\nTIP: Make sure the API server is running with "npm start" in app/api/');
    }
  }
}

testClassification();
