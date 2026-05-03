// server.js
import mqtt from 'mqtt';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import express from 'express';
import cors from 'cors';
import pkg from 'oracledb';
const { OUT_FORMAT_OBJECT } = pkg;
const oracledb = pkg;
import bcrypt from 'bcryptjs';
import { createProxyMiddleware } from "http-proxy-middleware";
import jwt from "jsonwebtoken";
import os from 'os';

const SECRET_KEY = "project_health_care_system"; // ควรเก็บใน .env จริงๆ

// ดึง IP address ของเครื่องปัจจุบัน
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // ข้าม internal addresses และ IPv6
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const IP = getLocalIP();

// InfluxDB config
const url = 'http://' + IP + ':8086';
const token = 'YATlSUIte4A8ioqGIDhdi7UPqNbbdYfg6-R3lIEsOShlMRLYvhKE_w1CGj3eEW1SKucytEXX5mq4Pa-5EqM8Mg==';
const org = '91e79a3c5a09bfbe';
const bucket = 'sensor_data';

const influx = new InfluxDB({ url, token });
const writeApi = influx.getWriteApi(org, bucket, 's');

// MQTT config
const mqttClient = mqtt.connect('mqtt://' + IP + ':1883');

const topics = ['sensors/+/mmwave/+']; // + = any room / any sensor_id

// 📊 เก็บข้อมูล MQTT - เพื่อใช้ประกอบการวิเคราะห์
const mqttDataStore = {};

// ⏱️ ค่าเฉลี่ยและโครงสร้างสำหรับการตัดสินใจ alert
const ALERT_AVG_WINDOW_MS = 30000; // ใช้เวลา 30 วินาทีในการคำนวณค่าเฉลี่ย
const ALERT_STABLE_MS = 10000; // ต้องคงระดับ alert นิ่ง 10 วินาที ก่อนส่ง MQTT

// 🧠 สถานะ alert ต่อ sensor
const alertState = {};

function shouldSendMQTTAlert(room, sensorID, level) {
  const key = `${room}:${sensorID}`;
  const now = Date.now();

  if (!alertState[key]) {
    alertState[key] = {
      lastEvaluatedLevel: level,
      lastLevelChangeAt: now,
      lastSentLevel: null,
      lastSentAt: null,
    };
    // ถ้าเป็น 0 ให้ส่งทันทีครั้งแรก (clear) เพื่อไม่ให้ค้าง
    if (level === 0) {
      alertState[key].lastSentLevel = 0;
      alertState[key].lastSentAt = now;
      return true;
    }
    return false; // ต้องรอสักครู่ให้ stable
  }

  const state = alertState[key];

  if (state.lastEvaluatedLevel !== level) {
    state.lastEvaluatedLevel = level;
    state.lastLevelChangeAt = now;
  }

  // กรณี level 0 ให้รีเซ็ตและส่งโดยทันที
  if (level === 0 && state.lastSentLevel !== 0) {
    state.lastSentLevel = 0;
    state.lastSentAt = now;
    return true;
  }

  const stableTime = now - state.lastLevelChangeAt;
  if (state.lastSentLevel === level) {
    return false; // ส่งไปแล้วระดับเดิม
  }

  if (stableTime >= ALERT_STABLE_MS) {
    state.lastSentLevel = level;
    state.lastSentAt = now;
    return true;
  }

  return false;
}

function getSmoothedSensorData(room, sensorID) {
  const key = `${room}:${sensorID}`;
  const history = mqttDataStore[key] || [];
  const now = Date.now();
  const windowData = history.filter(item => now - item.timestamp.getTime() <= ALERT_AVG_WINDOW_MS);

  if (windowData.length === 0) return null;

  const sum = windowData.reduce((acc, item) => {
    if (typeof item.heartrate === 'number') acc.heartrate += item.heartrate;
    if (typeof item.respiration === 'number') acc.respiration += item.respiration;
    if (typeof item.bedstatus === 'number') acc.bedstatusCount[item.bedstatus] = (acc.bedstatusCount[item.bedstatus] || 0) + 1;
    acc.count += 1;
    return acc;
  }, { heartrate: 0, respiration: 0, bedstatusCount: {}, count: 0 });

  const average = {
    heartrate: sum.heartrate / sum.count,
    respiration: sum.respiration / sum.count,
    bedstatus: 0,
    sampleCount: sum.count
  };

  // ค่า bedstatus แบบ majority
  const statusEntries = Object.entries(sum.bedstatusCount);
  if (statusEntries.length > 0) {
    statusEntries.sort((a, b) => b[1] - a[1]);
    average.bedstatus = Number(statusEntries[0][0]);
  }

  return average;
}

mqttClient.on('connect', () => {
  mqttClient.subscribe(topics, (err) => {
    if (!err) console.log('Subscribed to all mmWave sensors ✅');
  });
});

mqttClient.on('message', async (topic, message) => {
  try {
    const parts = topic.split('/');
    const room = parts[1];
    const sensorType = parts[2];
    const sensorID = parts[3];

    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (jsonErr) {
      console.error('❌ Invalid JSON from topic:', topic, jsonErr.message);
      return;
    }

    // เก็บลง memory
    const storeKey = `${room}:${sensorID}`;
    if (!mqttDataStore[storeKey]) {
      mqttDataStore[storeKey] = [];
    }

    mqttDataStore[storeKey].push({
      ...data,
      timestamp: new Date(),
      sensorID,
      room
    });

    if (mqttDataStore[storeKey].length > 100) {
      mqttDataStore[storeKey].shift();
    }

    // ✅ 1) ส่ง raw realtime ไปหน้าเว็บทันที
    sendToClients("raw", {
      type: "raw",
      room,
      sensorType,
      sensorID,
      data,
      timestamp: new Date().toISOString()
    });

    // ✅ 2) งานหนักค่อยทำต่อ
    const point = new Point(sensorType)
      .tag('room', room)
      .tag('sensorID', sensorID);

    for (const [field, val] of Object.entries(data)) {
      if (typeof val === 'number') {
        point.floatField(field, val);
      } else {
        point.stringField(field, String(val));
      }
    }

    await writeApi.writePoint(point);
    await writeApi.flush();

    // ✅ 3) คำนวณ alert แล้วค่อยส่ง alert update
    let alertLevel = 0;

    if (
      typeof data.heartrate === 'number' &&
      typeof data.respiration === 'number' &&
      typeof data.bedstatus === 'number'
    ) {
      const smoothed = getSmoothedSensorData(room, sensorID);

      if (smoothed) {
        console.log(
          `📉 Smoothed values (${room}:${sensorID}) - HR:${smoothed.heartrate.toFixed(1)}, RR:${smoothed.respiration.toFixed(1)}, Bed:${smoothed.bedstatus}, samples:${smoothed.sampleCount}`
        );

        alertLevel = await calculateAlertLevel(
          room,
          sensorID,
          smoothed.heartrate,
          smoothed.respiration,
          smoothed.bedstatus
        );

        const shouldPublish = shouldSendMQTTAlert(room, sensorID, alertLevel);

        sendToClients("alert", {
          type: "alert",
          room,
          sensorID,
          alertLevel,
          heartrate: Math.round(smoothed.heartrate),
          respiration: Math.round(smoothed.respiration),
          bedstatus: smoothed.bedstatus,
          sampleCount: smoothed.sampleCount,
          stable: shouldPublish,
          timestamp: new Date().toISOString()
        });

        if (shouldPublish) {
          
          console.log(`⏯️ Alert level ${alertLevel} stable ≥ ${ALERT_STABLE_MS / 1000}s, publishing MQTT`);
          
          sendAlertMQTT(room,
            sensorID,
            alertLevel,
            Math.round(smoothed.heartrate),
            Math.round(smoothed.respiration),
            smoothed.bedstatus);

        } else {

          const state = alertState[storeKey];
          const waited = state ? Math.min(ALERT_STABLE_MS, Date.now() - state.lastLevelChangeAt) : 0;
          
          console.log(`⏳ Alert level ${alertLevel} ยังไม่นิ่ง (รอ ${Math.max(0, ALERT_STABLE_MS - waited)}ms) ก่อนส่ง MQTT`);
        
        }
      }
    }

  } catch (err) {
    console.error('❌ Failed in MQTT handler:', err.message);
  }
});

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const clientLibDir = "C:\\oracle\\instantclient_23_9"

oracledb.initOracleClient({ libDir: clientLibDir })

const dbConfig = {
  user: "DBT68027",
  password: "64543",
  connectString: "localhost:1521/XEPDB1",
  poolMin: 1,
  poolMax: 10,
  poolIncrement: 1
}

async function initOracle() {
  try {
    await oracledb.createPool(dbConfig);
    console.log("✅ Oracle DB connected");
  } catch (err) {
    console.error("❌ Oracle DB connection error:", err);
    process.exit(1);
  }
}

const GRAFANA_URL = 'http://' + IP + ':3000';
// token จาก Grafana (สร้างในหน้า Configuration → API Keys)
const GRAFANA_TOKEN = "xxxxyour_grafana_api_tokenxxx";

app.use(
  "/grafana",
  createProxyMiddleware({
    target: GRAFANA_URL,
    changeOrigin: true,
    secure: false,
    ws: true,
    pathRewrite: {
      "^/grafana": "",
    },
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader("Authorization", `Bearer ${GRAFANA_TOKEN}`);
    },
  })
);

// ** เก็บ client SSE **
let clients = [];

// SSE endpoint
app.get('/api/sensors/stream', (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  res.write("\n");

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

// ฟังก์ชันส่งข้อมูลให้ทุก client SSE
const sendToClients = (eventName, data) => {
  const payload = JSON.stringify(data);
  clients.forEach(c => {
    c.res.write(`event: ${eventName}\n`);
    c.res.write(`data: ${payload}\n\n`);
  });
};


///**************************************************************************************************************** */
//***************************************************************************************************************** */

function verifyToken(req, res, next) {
  const token = req.headers["authorization"]; // ดึงจาก header: Authorization: Bearer <token>

  if (!token) {
    return res.status(403).json({ success: false, message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), SECRET_KEY);
    req.user = decoded; // เก็บข้อมูล user ไว้ใช้ต่อ
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

app.post("/api/login", async (req, res) => {
  const { ID, Passwd } = req.body;            // frontend ส่งชื่อเดิม ID/Passwd
  let conn;

  try {
    conn = await oracledb.getConnection();

    const r = await conn.execute(
      `SELECT ID, FIRST_NAME, LAST_NAME, USERNAME , PASSWORD_HASH
         FROM USERS
        WHERE USERNAME = :u`,
      { u: ID },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (r.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid ID or Password" });
    }

    const user = r.rows[0];

    // เปรียบเทียบรหัสผ่านที่ผู้ใช้กรอกกับ hash ในฐานข้อมูล
    const isMatch = await bcrypt.compare(Passwd, user.PASSWORD_HASH);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid ID or Password" });
    }

    // ✅ สร้าง JWT token
    const token = jwt.sign(
      { id: user.ID, username: user.USERNAME },
      SECRET_KEY);

    res.json({
      success: true,
      message: "Login success",
      token: token,
      user: {
        id: user.ID,
        username: user.USERNAME,
        firstName: user.FIRST_NAME,
        lastName: user.LAST_NAME,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "DB Error" });
  } finally {
    if (conn) await conn.close();
  }
});


//Load Data User
app.get("/api/getDataUser", verifyToken, async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection();
    const result = await connection.execute(
      `select u.id, u.first_name fname, u.last_name lname,
        ar.name pname
     from users u
     join access_rights ar on ar.id = u.access_right_id`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("DB Error");
  } finally {
    if (connection) await connection.close();
  }
});

//Delete User
app.delete("/api/DeleteUser/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    // 1️⃣ ตรวจสอบว่าผู้ใช้จะลบตัวเองหรือไม่
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        message: "You can't delete your own data."
      });
    }

    conn = await oracledb.getConnection();

    await conn.execute(
      `Delete from users 
      where id = :id`,
      { id },
      { autoCommit: true }
    );
    res.json({ message: "✅ Employee deleted successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).send("DB Delete Error");
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/getDataUser/lastid", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `SELECT MAX(ID) id FROM users`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error fetching lastid:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/getAccessRight", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `select * from access_rights`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching deptbus:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

//EDIT ดึงข้อมูลลงตารางมาโชว์
app.get("/api/getDataUser/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  let conn
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `select u.id, u.first_name fname, u.last_name lname,
              u.username ,u.access_right_id acrid
       from users u
       where u.id = :id`,
      [id],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบพนักงาน" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error fetching employee:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

//EDIT อันนี้ update ข้อมูล
app.put("/api/UpdateUser/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { FNAME, LNAME, ACRID, USERNAME, PASSWORD } = req.body;
  let conn;

  try {
    conn = await oracledb.getConnection();

    // 🔍 ตรวจสอบว่ามี username ซ้ำหรือไม่
    const check = await conn.execute(
      `SELECT COUNT(*) AS CNT FROM USERS WHERE USERNAME = :u and ID != :id`,
      { u: USERNAME, id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (check.rows[0].CNT > 0) {
      return res
        .status(409) // 409 = Conflict
        .json({ success: false, message: "Username already exists" });
    }

    let result = null;

    if (PASSWORD !== undefined) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(PASSWORD, salt);

      result = await conn.execute(
        `update users
       set first_name  = :FNAME,
          last_name  = :LNAME,
          access_right_id  = :ACRID,
          username = :USERNAME,
          password_hash = :PASSWORD
       where id   = :ID`,
        { ID: id, FNAME, LNAME, ACRID, USERNAME, PASSWORD: hashedPassword },
        { autoCommit: true }
      );
    } else {
      result = await conn.execute(
        `update users
       set first_name  = :FNAME,
          last_name  = :LNAME,
          username = :USERNAME,
          access_right_id  = :ACRID
       where id   = :ID`,
        { ID: id, FNAME, LNAME, USERNAME, ACRID },
        { autoCommit: true }
      );
    }

    if (result.rowsAffected === 0) {
      return res.status(404).json({ message: "❌ ไม่พบข้อมูลผู้ใช้" });
    }
    res.json({ message: "User information has been edited" });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error("❌ Error updating user:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


//ADD
app.post("/api/UpdateUser", verifyToken, async (req, res) => {
  const { ID, FNAME, LNAME, ACRID, USERNAME, PASSWORD } = req.body;
  let conn;

  try {
    conn = await oracledb.getConnection();

    // 🔍 ตรวจสอบว่ามี username ซ้ำหรือไม่
    const check = await conn.execute(
      `SELECT COUNT(*) AS CNT FROM USERS WHERE USERNAME = :u`,
      { u: USERNAME },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (check.rows[0].CNT > 0) {
      return res
        .status(409) // 409 = Conflict
        .json({ success: false, message: "Username already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(PASSWORD, salt);

    await conn.execute(
      `insert into users (id, first_name, last_name , username ,password_hash, access_right_id)
      values (:ID, :FNAME, :LNAME, :USERNAME, :PASSWORD, :ACRID)`,
      { ID, FNAME, LNAME, USERNAME, PASSWORD: hashedPassword, ACRID },
      { autoCommit: true }
    );

    res.json({ message: "User information successful", ID: ID });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error("❌ Error inserting user:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/getRooms", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `SELECT DISTINCT
          r.ID,
          r.NAME
       FROM USERS u
       JOIN ROOM_ACCESS ra
         ON ra.ACCESS_RIGHT_ID = u.ACCESS_RIGHT_ID
       JOIN ROOMS r
         ON r.ID = ra.ROOMID
       WHERE u.ID = :userId
       ORDER BY r.ID`,
      { userId: req.user.id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching rooms:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

async function getAllowedRoomNamesByUserId(userId) {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `SELECT DISTINCT r.NAME
       FROM USERS u
       JOIN ROOM_ACCESS ra
         ON ra.ACCESS_RIGHT_ID = u.ACCESS_RIGHT_ID
       JOIN ROOMS r
         ON r.ID = ra.ROOMID
       WHERE u.ID = :userId
       ORDER BY r.NAME`,
      { userId: Number(userId) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return result.rows.map((row) => row.NAME);
  } finally {
    if (conn) await conn.close();
  }
}

app.get("/api/my-room-access", verifyToken, async (req, res) => {
  let conn;

  try {
    conn = await oracledb.getConnection();

    const result = await conn.execute(
      `SELECT DISTINCT
          r.ID,
          r.NAME
       FROM USERS u
       JOIN ROOM_ACCESS ra
         ON ra.ACCESS_RIGHT_ID = u.ACCESS_RIGHT_ID
       JOIN ROOMS r
         ON r.ID = ra.ROOMID
       WHERE u.ID = :userId
       ORDER BY r.ID`,
      { userId: req.user.id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      success: true,
      rooms: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching room access:", err);
    res.status(500).json({
      success: false,
      message: "DB error"
    });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/getPageMenu", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `SELECT ID, NAME FROM PAGE_MENUS ORDER BY ID`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching pages:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/getUserAccessRight", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();

    const accRooms = await conn.execute(
      `select ar.id as ARID, ar.name as ARName , ra.roomid as RID from access_rights ar
        left join room_access ra on ra.access_right_id = ar.ID`
      , {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })

    const accPages = await conn.execute(
      `select ar.id as ARID, ar.name as ARName , p.pageid as PID from access_rights ar
          left join page_access p on p.access_right_id = ar.ID`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT })

    // ✅ รวมผลลัพธ์
    const combined = {};

    // รวมสิทธิ์ห้อง
    accRooms.rows.forEach(row => {
      if (!combined[row.ARID]) {
        combined[row.ARID] = {
          ARID: row.ARID,
          ARName: row.ARNAME,
          Rooms: [],
          Pages: [],
        };
      }
      if (row.RID) {
        combined[row.ARID].Rooms.push({
          RID: row.RID,
        });
      }
    });

    // รวมสิทธิ์หน้าเพจ
    accPages.rows.forEach(row => {
      if (!combined[row.ARID]) {
        combined[row.ARID] = {
          ARID: row.ARID,
          ARName: row.ARNAME,
          Rooms: [],
          Pages: [],
        };
      }
      if (row.PID) {
        combined[row.ARID].Pages.push({
          PID: row.PID,
        });
      }
    });

    // แปลงกลับเป็น array ก่อนส่งออก
    const result = Object.values(combined);

    res.json(result);
  } catch (err) {
    console.error("❌ Error fetching access rights:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});


app.post("/api/updateAccessRight", verifyToken, async (req, res) => {
  const { roleName, roomIds, pageIds } = req.body;
  let conn;

  try {
    conn = await oracledb.getConnection();

    // 1️⃣ หา id ล่าสุด + 1
    const result = await conn.execute(
      `SELECT NVL(MAX(id), 0) AS maxId FROM access_rights`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const nextId = result.rows[0].MAXID + 1;

    // 2️⃣ insert role ลง access_rights
    await conn.execute(
      `INSERT INTO access_rights (id, name) VALUES (:id, :name)`,
      { id: nextId, name: roleName },
      { autoCommit: false }
    );

    // 3️⃣ insert room access
    if (roomIds.length > 0) {
      const roomBind = roomIds.map(rid => ({
        roomid: rid,
        access_right_id: nextId,
      }));

      const roomSql = `INSERT INTO room_access (roomid, access_right_id) VALUES (:roomid, :access_right_id)`;
      await conn.executeMany(roomSql, roomBind, { autoCommit: false });
    }

    // 4️⃣ insert page access
    if (pageIds.length > 0) {
      const pageBind = pageIds.map(pid => ({
        id: pid,
        access_right_id: nextId,
      }));

      const pageSql = `INSERT INTO page_access (pageid, access_right_id) VALUES (:id, :access_right_id)`;
      await conn.executeMany(pageSql, pageBind, { autoCommit: false });
    }

    await conn.commit();

    res.json({ success: true, accessRightId: nextId });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Save error:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

app.put("/api/updateAccessRight/:id", verifyToken, async (req, res) => {
  const accessRightId = parseInt(req.params.id);
  const { roleName, roomIds, pageIds } = req.body;
  let conn;

  try {
    conn = await oracledb.getConnection();

    // 1️⃣ update role name
    await conn.execute(
      `UPDATE access_rights SET name = :name WHERE id = :id`,
      { name: roleName, id: accessRightId },
      { autoCommit: false }
    );

    // 2️⃣ update room access
    // ลบสิทธิ์เดิมก่อน
    await conn.execute(
      `DELETE FROM room_access WHERE access_right_id = :id`,
      { id: accessRightId },
      { autoCommit: false }
    );

    if (Array.isArray(roomIds) && roomIds.length > 0) {
      const roomBind = roomIds.map(rid => ({
        roomid: rid,
        access_right_id: accessRightId,
      }));
      const roomSql = `INSERT INTO room_access (roomid, access_right_id) VALUES (:roomid, :access_right_id)`;
      await conn.executeMany(roomSql, roomBind, { autoCommit: false });
    }

    // 3️⃣ update page access
    // ลบสิทธิ์เดิมก่อน
    await conn.execute(
      `DELETE FROM page_access WHERE access_right_id = :id`,
      { id: accessRightId },
      { autoCommit: false }
    );

    if (Array.isArray(pageIds) && pageIds.length > 0) {
      const pageBind = pageIds.map(pid => ({
        pageid: pid,
        access_right_id: accessRightId,
      }));
      const pageSql = `INSERT INTO page_access (pageid, access_right_id) VALUES (:pageid, :access_right_id)`;
      await conn.executeMany(pageSql, pageBind, { autoCommit: false });
    }

    await conn.commit();

    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Update error:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

app.delete("/api/updateAccessRight/:id", verifyToken, async (req, res) => {
  const accessRightId = parseInt(req.params.id);
  let conn;

  try {
    conn = await oracledb.getConnection();

    // 1️⃣ ตรวจสอบว่ามี user ใช้งานสิทธิ์นี้อยู่หรือไม่
    const checkUser = await conn.execute(
      `SELECT COUNT(*) AS CNT FROM users WHERE access_right_id = :id`,
      { id: accessRightId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    console.log(checkUser);

    if (checkUser.rows[0].CNT > 0) {
      return res.status(400).json({
        error: "Cannot be deleted! There is a user with this right."
      });
    }

    // 2️⃣ ลบ room access ที่เกี่ยวข้อง
    await conn.execute(
      `DELETE FROM room_access WHERE access_right_id = :id`,
      { id: accessRightId },
      { autoCommit: false }
    );

    // 3️⃣ ลบ page access ที่เกี่ยวข้อง
    await conn.execute(
      `DELETE FROM page_access WHERE access_right_id = :id`,
      { id: accessRightId },
      { autoCommit: false }
    );

    // 4️⃣ ลบ access_rights
    await conn.execute(
      `DELETE FROM access_rights WHERE id = :id`,
      { id: accessRightId },
      { autoCommit: false }
    );

    await conn.commit();

    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Delete error:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});



app.get("/api/getDashboard", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `SELECT ID, DEVICE_NAME , GRAFANA_URL FROM DASHBOARD ORDER BY ID`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching pages:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

//Load Data Config
app.get("/api/getConfig", verifyToken, async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection();
    const result = await connection.execute(
      `select * from device_conf`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("DB Error");
  } finally {
    if (connection) await connection.close();
  }
});

app.post("/api/addConfig", verifyToken, async (req, res) => {
  const { roomId, sensorName, birthday } = req.body;
  let connection;

  try {
    connection = await oracledb.getConnection();

    await connection.execute(
      `INSERT INTO device_conf (id, device_name , roomid, dateofbirth)
       VALUES (device_config_seq.NEXTVAL, :sensorName, :roomId, TO_DATE(:birthday, 'YYYY-MM-DD'))`,
      { sensorName, roomId, birthday },
      { autoCommit: true }
    );

    res.json({ message: "Added", status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: false,
      message: err.message
    });
  } finally {
    if (connection) await connection.close();
  }
});

app.put("/api/updateConfig", verifyToken, async (req, res) => {
  const { id, roomId, sensorName, birthday } = req.body;
  let connection;

  try {
    connection = await oracledb.getConnection();

    await connection.execute(
      `UPDATE device_conf
       SET device_name = :sensorName,
            roomid = :roomId,
           dateofbirth = TO_DATE(:birthday, 'YYYY-MM-DD')
       WHERE id = :id`,
      { id, roomId, sensorName, birthday },
      { autoCommit: true }
    );

    res.json({ status: true, message: "Updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: false,
      message: err.message
    });
  } finally {
    if (connection) await connection.close();
  }
});

app.delete("/api/deleteConfig", verifyToken, async (req, res) => {
  const { id, roomId } = req.body;
  let connection;

  try {
    connection = await oracledb.getConnection();

    await connection.execute(
      `DELETE FROM device_conf
       WHERE id = :id AND roomid = :roomId`,
      { id, roomId },
      { autoCommit: true }
    );

    res.json({ status: true, message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: false,
      message: err.message
    });
  } finally {
    if (connection) await connection.close();
  }
});

function calculateAge(dob) {
  const today = new Date();
  const birth = new Date(dob);

  let age = today.getFullYear() - birth.getFullYear();

  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}

function getHRRangeByAge(ageYears) {
  if (ageYears < 1) return [80, 140];  // 1–12 เดือน
  if (ageYears < 3) return [80, 130];  // 1–3 ปี
  if (ageYears < 6) return [80, 110];  // 3–5 ปี
  if (ageYears < 13) return [70, 100];  // 6–12 ปี
  return [60, 100];                       // วัยรุ่นและผู้ใหญ่
}

function getRRRangeByAge(ageYears) {
  if (ageYears < 1) return [30, 60];   // ทารก
  if (ageYears < 3) return [24, 40];   // เด็กเล็ก
  if (ageYears < 6) return [22, 34];   // ก่อนวัยเรียน
  if (ageYears < 13) return [18, 30];  // เด็กโต
  return [12, 20];                     // วัยรุ่น/ผู้ใหญ่
}

async function getConfigDevice(device) {
  try {
    const connection = await oracledb.getConnection("default");

    const result = await connection.execute(
      `select * from device_conf where device_name = :device`,
      [device],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    await connection.close();
    return result.rows[0];

  } catch (err) {
    console.error(err);
  }
}

async function updateBaselineInDatabase() {
  try {
    console.log("🔄 Updating baselines in database...");
    const connection = await oracledb.getConnection("default");

    // ดึงทุก device configuration
    const result = await connection.execute(
      `SELECT d.id, d.device_name, r.id as roomid, r.name FROM device_conf d join rooms r on r.id = d.ROOMID`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const devices = result.rows;
    console.log(`📊 Found ${devices.length} devices to update`);

    for (const device of devices) {
      // คำนวณ baseline สำหรับแต่ละ device
      const baseline = await calculateBaselineRobust(device.NAME, device.DEVICE_NAME);

      if (baseline) {
        console.log(`✅ Updating baseline for ${device.NAME}:${device.DEVICE_NAME}`);
        console.log(`   → Calculated baseline HR: ${baseline.baselineHR}, RR: ${baseline.baselineRR}`);

        const updateResult = await connection.execute(
          `UPDATE device_conf 
     SET baseline_hr = :baselineHR, 
         baseline_rr = :baselineRR,
         baseline_update = SYSDATE
     WHERE id = :id`,
          {
            baselineHR: baseline.baselineHR,
            baselineRR: baseline.baselineRR,
            id: device.ID
          },
          { autoCommit: true }
        );

        console.log("updateResult =", updateResult);
        console.log("rowsAffected =", updateResult.rowsAffected);

        if (updateResult.rowsAffected === 0) {
          console.warn(`⚠️ update ไม่โดน row ใดเลย id=${device.ID}`);
        } else {
          console.log(`✅ update สำเร็จ id=${device.ID}`);

        }
      } else {
        console.warn(`⚠️ Could not calculate baseline for ${device.NAME}:${device.DEVICE_NAME}`);
      }
    }

    await connection.close();
  } catch (err) {
    console.error("❌ Error updating baselines:", err);
  }
}

async function calculateBaselineRobust(roomName, sensorName) {
  try {
    const queryApi = influx.getQueryApi(org).with({ timeout: '60000ms' });  // 60 วินาที
    console.log(`Calculating baseline for ${roomName}:${sensorName} ...`);

    const filterCondition = `
      exists r.heartrate and
      exists r.respiration and
      exists r.bedstatus and
      (r.bedstatus == 1) and
      r.heartrate >= 50 and r.heartrate <= 120 and
      r.respiration >= 8 and r.respiration <= 25
    `;

    const fluxQueryHR = `
      from(bucket: "sensor_data")
        |> range(start: -6h)
        |> filter(fn: (r) => r["_measurement"] == "mmwave")
        |> filter(fn: (r) => r["room"] == "${roomName}")
        |> filter(fn: (r) => r["sensorID"] == "${sensorName}")
        |> pivot(
            rowKey: ["_time"],
            columnKey: ["_field"],
            valueColumn: "_value"
        )
        |> filter(fn: (r) => ${filterCondition})
        |> mean(column: "heartrate")
    `;

    const fluxQueryRR = `
      from(bucket: "sensor_data")
        |> range(start: -6h)
        |> filter(fn: (r) => r["_measurement"] == "mmwave")
        |> filter(fn: (r) => r["room"] == "${roomName}")
        |> filter(fn: (r) => r["sensorID"] == "${sensorName}")
        |> pivot(
            rowKey: ["_time"],
            columnKey: ["_field"],
            valueColumn: "_value"
        )
        |> filter(fn: (r) => ${filterCondition})
        |> mean(column: "respiration")
    `;

    const hrRows = await queryApi.collectRows(fluxQueryHR);
    const rrRows = await queryApi.collectRows(fluxQueryRR);

    console.log("HR rows:", hrRows);
    console.log("RR rows:", rrRows);

    const baselineHR = hrRows.length > 0 ? Number(hrRows[0].heartrate) : null;
    const baselineRR = rrRows.length > 0 ? Number(rrRows[0].respiration) : null;

    if (baselineHR === null || baselineRR === null) {
      console.log("No valid baseline data");
      return null;
    }

    return {
      baselineHR,
      baselineRR,
    };
  } catch (err) {
    console.error("calculateBaselineRobust error:", err);
    return null;
  }
}

// 🔴 **ฟังก์ชันคำนวณระดับ Alert ตาม Rules**
async function calculateAlertLevel(room, sensorID, heartrate, respiration, bedstatus) {
  try {
    if (bedstatus !== 1) return 0;

    const deviceConfig = await getConfigDevice(sensorID);
    if (!deviceConfig) {
      console.warn(`⚠️ No device config found for sensor ${sensorID}`);
      return 0;
    }

    const age = calculateAge(deviceConfig.DATEOFBIRTH);
    const [baseHrMin, baseHrMax] = getHRRangeByAge(age);
    const [baseRrMin, baseRrMax] = getRRRangeByAge(age);

    // buffer zone
    const hrMin = baseHrMin * 0.92;
    const hrMax = baseHrMax * 1.08;
    const rrMin = baseRrMin * 0.92;
    const rrMax = baseRrMax * 1.08;

    const hrMargin = age < 1 ? 30 :
      age < 6 ? 25 :
        age < 13 ? 20 : 15;

    const rrMargin = age < 1 ? 15 :
      age < 6 ? 10 :
        age < 13 ? 8 : 6;

    // absolute danger
    if (heartrate < baseHrMin - hrMargin || heartrate > baseHrMax + hrMargin) return 2;
    if (respiration < baseRrMin - rrMargin || respiration > baseRrMax + rrMargin) return 2;

    const hrAbnormal = heartrate < hrMin || heartrate > hrMax;
    const rrAbnormal = respiration < rrMin || respiration > rrMax;

    if (hrAbnormal || rrAbnormal) {
      const baselineHR = Number(deviceConfig.BASELINE_HR);
      const baselineRR = Number(deviceConfig.BASELINE_RR);

      if (baselineHR > 0 && baselineRR > 0) {
        const hrDeviation = Math.abs(heartrate - baselineHR) / baselineHR;
        const rrDeviation = Math.abs(respiration - baselineRR) / baselineRR;

        if (hrDeviation > 0.35 || rrDeviation > 0.35) return 2;
      }

      return 1;
    }

    return 0;
  } catch (err) {
    console.error("❌ Error calculating alert level:", err);
    return 0;
  }
}

// 📡 **ฟังก์ชันส่ง MQTT Alert ไปยัง Public Topic**
function sendAlertMQTT(room, sensorID, alertLevel, heartrate, respiration, bedstatus) {
  try {
    const alertData = {
      room: room,
      sensorID: sensorID,
      alertLevel: alertLevel, // 0=ปกติ, 1=คอยระวัง, 2=อันตราย
      heartrate: heartrate,
      respiration: respiration,
      bedstatus: bedstatus,
      timestamp: new Date().toISOString()
    };

    // ส่งไปยัง public topic
    const topic = `alerts/${room}/${sensorID}`;
    const payload = JSON.stringify(alertData);
    console.log(`📤 Publishing MQTT alert: topic=${topic}, payload=${payload}`);

    mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) {
        console.error('❌ Failed to publish alert:', err, 'topic=', topic, 'payload=', payload);
      } else {
        console.log(`🚨 Alert sent: ${topic} - Level ${alertLevel}`);
      }
    });

  } catch (err) {
    console.error("❌ Error sending alert MQTT:", err);
  }
}


// ✅ API ดึงข้อมูลค่าที่เกินกำหนด
app.post("/api/alerts", verifyToken, async (req, res) => {
  const { room, date } = req.body;
  console.log(room, date);

  if (!date || !room) {
    return res.status(400).json({ error: "กรุณาระบุ room และ date" });
  }

  try {
    const allowedRooms = await getAllowedRoomNamesByUserId(req.user.id);

    if (!allowedRooms.includes(room)) {
      return res.status(403).json({ error: "No permission for this room" });
    }

    const start = `${date}T00:00:00Z`;
    const stop = `${date}T23:59:59Z`;

    const HR_MIN = 50;
    const HR_MAX = 120;
    const RR_MIN = 8;
    const RR_MAX = 25;

    const fluxQuery = `
      from(bucket: "sensor_data")
        |> range(start: ${start}, stop: ${stop})
        |> filter(fn: (r) => r["_measurement"] == "mmwave")
        |> filter(fn: (r) => r["room"] == "${room}")
        |> pivot(
            rowKey:["_time"],
            columnKey: ["_field"],
            valueColumn: "_value"
          )
        |> filter(fn: (r) =>
            ((r.heartrate < ${HR_MIN} or r.heartrate > ${HR_MAX}) or
            (r.respiration < ${RR_MIN} or r.respiration > ${RR_MAX})) and
            (r.bedstatus == 1)
          )
        |> yield(name: "abnormal")
    `;

    const queryApi = influx.getQueryApi(org);
    const result = await queryApi.collectRows(fluxQuery);
    res.json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error("❌ Query error:", error);
    res.status(500).json({ error: "Query error" });
  }
});

app.post("/api/dataTimeLine", verifyToken, async (req, res) => {
  const { room, start, end } = req.body;

  console.log(room, start, end);

  if (!start || !end || !room) {
    return res.status(400).json({ error: "กรุณาระบุ room, start และ end" });
  }

  try {
    const allowedRooms = await getAllowedRoomNamesByUserId(req.user.id);

    if (!allowedRooms.includes(room)) {
      return res.status(403).json({ error: "No permission for this room" });
    }

    const fluxQuery = `
      from(bucket: "sensor_data")
        |> range(start: time(v: "${start}"), stop: time(v: "${end}"))
        |> filter(fn: (r) => r["_measurement"] == "mmwave")
        |> filter(fn: (r) => r["room"] == "${room}")
        |> pivot(
            rowKey:["_time"],
            columnKey: ["_field"],
            valueColumn: "_value"
          )
        |> sort(columns: ["_time"], desc: false)
    `;

    const queryApi = influx.getQueryApi(org);
    const result = await queryApi.collectRows(fluxQuery);

    res.json({
      success: true,
      count: result.length,
      data: result
    });
  } catch (error) {
    console.error("❌ Query error:", error);
    res.status(500).json({ error: "Query error" });
  }
});

app.get("/api/getDashboard", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `SELECT d.ID, d.DEVICE_NAME, d.GRAFANA_URL, d.ROOMID, r.NAME AS ROOM_NAME
       FROM DASHBOARD d
       JOIN ROOMS r
         ON r.ID = d.ROOMID
       JOIN USERS u
         ON u.ID = :userId
       JOIN ROOM_ACCESS ra
         ON ra.ACCESS_RIGHT_ID = u.ACCESS_RIGHT_ID
        AND ra.ROOMID = d.ROOMID
       ORDER BY d.ID`,
      { userId: req.user.id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching dashboard:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

app.delete("/api/deleteDashboard/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  let conn;

  try {
    conn = await oracledb.getConnection();

    await conn.execute(
      `DELETE FROM DASHBOARD WHERE ID = :id`,
      { id },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: "ลบข้อมูลสำเร็จ"
    });
  } catch (err) {
    console.error("❌ Error deleting dashboard:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/getDashboardFull", verifyToken, async (req, res) => {
  let conn;
  try {
    conn = await oracledb.getConnection();
    const result = await conn.execute(
      `SELECT d.ID, d.DEVICE_NAME, d.GRAFANA_URL, d.ROOMID, r.NAME AS ROOM_NAME
       FROM DASHBOARD d
       JOIN ROOMS r ON r.ID = d.ROOMID
       ORDER BY d.ID`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching dashboard full:", err);
    res.status(500).json({ error: "DB error" });
  } finally {
    if (conn) await conn.close();
  }
});

app.put("/api/updateDashboard/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { roomId, sensorName, grafanaUrl } = req.body;
  let conn;

  try {
    conn = await oracledb.getConnection();

    const check = await conn.execute(
      `SELECT COUNT(*) AS CNT
       FROM DASHBOARD
       WHERE ROOMID = :roomId
         AND DEVICE_NAME = :sensorName
         AND ID <> :id`,
      { roomId, sensorName, id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (check.rows[0].CNT > 0) {
      return res.status(409).json({
        success: false,
        message: "รายการนี้มีอยู่แล้ว"
      });
    }

    const result = await conn.execute(
      `UPDATE DASHBOARD
       SET DEVICE_NAME = :sensorName,
           GRAFANA_URL = :grafanaUrl,
           ROOMID = :roomId
       WHERE ID = :id`,
      { id, roomId, sensorName, grafanaUrl },
      { autoCommit: true }
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลที่ต้องการแก้ไข"
      });
    }

    res.json({
      success: true,
      message: "แก้ไขข้อมูลสำเร็จ"
    });
  } catch (err) {
    console.error("❌ Error updating dashboard:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  } finally {
    if (conn) await conn.close();
  }
});

app.get("/api/my-menu-access", verifyToken, async (req, res) => {
  let conn;

  try {
    conn = await oracledb.getConnection();

    const result = await conn.execute(
      `SELECT 
          pm.ID,
          pm.NAME
       FROM USERS u
       JOIN PAGE_ACCESS pa
         ON pa.ACCESS_RIGHT_ID = u.ACCESS_RIGHT_ID
       JOIN PAGE_MENUS pm
         ON pm.ID = pa.PAGEID
       WHERE u.ID = :userId
       ORDER BY pm.ID`,
      { userId: req.user.id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      success: true,
      userId: req.user.id,
      menus: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching menu access:", err);
    res.status(500).json({
      success: false,
      message: "DB error"
    });
  } finally {
    if (conn) await conn.close();
  }
});


async function startServer() {
  // ✅ สร้าง pool ก่อน
  await initOracle();

  // ✅ แล้วค่อย start server
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // 📊 Update baseline ทุก 6 ชม. (6 * 60 * 60 * 1000 milliseconds)
  const BASELINE_UPDATE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

  // เรียกครั้งแรกทันที
  await updateBaselineInDatabase();

  // ตั้ง interval เรียก ทุก 6 ชม.
  setInterval(async () => {
    console.log("⏰ Time to update baselines...");
    await updateBaselineInDatabase();
  }, BASELINE_UPDATE_INTERVAL);

  console.log("✅ Baseline update scheduled every 6 hours");
}

startServer();