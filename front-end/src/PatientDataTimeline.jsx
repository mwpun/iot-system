import { useEffect, useState } from "react";
import axios from "axios";
import timeline from "./PatientDataTimeline.module.css";
import Navbar from "./component/navbar.jsx";
import Header from "./component/header.jsx";
import { API_URL } from "./config/apiConfig";

export default function PatientDataTimeline() {
  const [rooms, setRooms] = useState([]);
  const [dataTimeLine, setDataTimeLine] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [loading, setLoading] = useState(false);
  const token = localStorage.getItem("token");

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
    const fetchTimeline = async () => {
      if (!selectedRoom || !startDateTime || !endDateTime) return;

      setLoading(true);

      const startISO = new Date(startDateTime).toISOString();
      const endISO = new Date(endDateTime).toISOString();

      try {
        const res = await axios.post(
          `${API_URL}/api/dataTimeLine`,
          { room: selectedRoom, start: startISO, end: endISO },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setDataTimeLine(res.data || []);
      } catch (e) {
        console.error(e);
        setDataTimeLine([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTimeline();
  }, [selectedRoom, startDateTime, endDateTime]);

  return (
    <div className={timeline.shell}>
      <Header />
      <div className={timeline.body}>
        <Navbar />
        <div className={timeline.main}>
          <div className={timeline.filterRow}>
            <div className={timeline.inputGroup}>
              <label>เริ่มต้น</label>
              <br />
              <input
                type="datetime-local"
                value={startDateTime}
                onChange={(e) => setStartDateTime(e.target.value)}
              />
            </div>

            <div className={timeline.inputGroup}>
              <label>สิ้นสุด</label>
              <br />
              <input
                type="datetime-local"
                value={endDateTime}
                onChange={(e) => setEndDateTime(e.target.value)}
              />
            </div>
          </div>

          <div className={timeline.tabsRow}>
            <div className={timeline.tabs}>
              {rooms.length > 0 ? (
                rooms.map((r) => (
                  <button
                    key={`r-${r.ID}`}
                    className={`${timeline.tab} ${
                      r.NAME === selectedRoom ? timeline.active : ""
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

          <div className={timeline.card}>
            <div className={timeline.title}>
              Patient Data Timeline – {selectedRoom || "-"}
            </div>
            <div className={timeline.tableWrap}>
              <table className={timeline.table}>
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
                      <td colSpan={6} className={timeline.center}>
                        Loading...
                      </td>
                    </tr>
                  ) : Array.isArray(dataTimeLine?.data) &&
                    dataTimeLine.data.length > 0 ? (
                    dataTimeLine.data.map((item, i) => (
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
                      <td colSpan={6} className={timeline.center}>
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