// Endereço da API. Em produção, troque pelo endereço do serviço no Render.
(function () {
  const PRODUCTION_API = 'https://futebol-api.onrender.com/api/v1';
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);

  window.APP_CONFIG = {
    API_URL: isLocal ? 'http://localhost:3000/api/v1' : PRODUCTION_API,
  };
})();
