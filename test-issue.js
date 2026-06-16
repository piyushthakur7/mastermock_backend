import fetch from 'node-fetch';

const baseUrl = "http://localhost:3000/api/v1";
// wait, the server might not be running locally, let me hit the deployed one or I can just run it using mongoose locally!
// Actually, I can just connect to the DB using the env variables in the project!
