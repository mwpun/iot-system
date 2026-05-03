import { useEffect, useState } from "react";
import axios from "axios";
import alert from "./AlertsPage.module.css";
import Navbar from "./component/navbar.jsx";
import Header from "./component/header.jsx";
import { API_URL } from "./config/apiConfig";

export default function AlertsPage() {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [alerts, setAlerts] = useState({ data: [] });
  const [loading, setLoading] = useState(false);
  const token = localStorage.getItem("token");
  const date = new Date();

  const getRooms = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/my-room-access`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRooms(res.data?.rooms || []);
    } catch (err) {
      console.error("getRooms error:", err);
      setRooms([]);
    }
  };

  useEffect(() => {
    getRooms();
  }, []);

  useEffect(() => {
    if (rooms.length > 0 && !selectedRoom) {
      setSelectedRoom(rooms[0].NAME);
    } else if (rooms.length === 0) {
      setSelectedRoom(null);
    }
  }, [rooms, selectedRoom]);

  useEffect(() => {
    const fetchAlerts = async () => {
      if (!selectedRoom) return;

      setLoading(true);
      try {
        const res = await axios.post(
          `${API_URL}/api/alerts`,
          { room: selectedRoom, date: formatDate(date) },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setAlerts(res.data || { data: [] });
      } catch (e) {
        console.error(e);
        setAlerts({ data: [] });
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
  }, [selectedRoom]);

  return (
    <div className={alert.shell}>
      <Header />
      <div className={alert.body}>
        <Navbar />
        <div className={alert.main}>
          <div className={alert.tabsRow}>
            <div className={alert.tabs}>
              {rooms.length > 0 ? (
                rooms.map((r) => (
                  <button
                    key={`r-${r.ID}`}
                    className={`${alert.tab} ${
                      r.NAME === selectedRoom ? alert.active : ""
                    }`}
                    onClick={() => setSelectedRoom(r.NAME)}
                  >
                    {r.NAME}
                  </button>
                ))
              ) : (
                <h3>ไม่มีห้องที่มีสิทธิ์เข้าถึง</h3>
              )}
            </div>
          </div>

          <div className={alert.card}>
            <div className={alert.title}>Alerts – {selectedRoom || "-"}</div>
            <div className={alert.tableWrap}>
              <table className={alert.table}>
                <thead>
                  <tr>
                    <th>ลำดับ</th>
                    <th>วัน-เวลา</th>
                    <th>Device</th>
                    <th>อัตราการเต้นหัวใจ (BPM)</th>
                    <th>อัตราการหายใจ (RR)</th>
                    <th>สถานะการอยู่บนเตียง</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className={alert.center}>
                        Loading...
                      </td>
                    </tr>
                  ) : Array.isArray(alerts?.data) && alerts.data.length > 0 ? (
                    alerts.data.map((item, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{formatDateTime(item._time)}</td>
                        <td>{item.sensorID ?? "-"}</td>
                        <td>{item.heartrate ?? "-"}</td>
                        <td>{item.respiration ?? "-"}</td>
                        {(() => {
                          switch (item.bedstatus) {
                            case 0:
                              return <td>Out of bed</td>;
                            case 1:
                              return <td>In bed</td>;
                            default:
                              return <td>No Data</td>;
                          }
                        })()}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className={alert.center}>
                        ไม่มีข้อมูล
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(t) {
  if (!t) return "-";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;

  return d.toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(t) {
  if (!t) return "-";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;

  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}