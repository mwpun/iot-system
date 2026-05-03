// Dynamic API URL based on current hostname
export const getApiUrl = () => {
  const hostname = window.location.hostname;
  const port = 5000;
  
  // ถ้าเป็น localhost หรือ 127.0.0.1 ให้ใช้ port 5000
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `http://localhost:${port}`;
  }
  
  // ใช้ IP ปัจจุบันของเครื่อง
  return `http://${hostname}:${port}`;
};

export const API_URL = getApiUrl();
