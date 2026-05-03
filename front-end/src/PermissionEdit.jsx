import { useState, useEffect } from "react";
import Permission from "./PermissionEdit.module.css";
import axios from "axios";
import Swal from "sweetalert2";
import Navbar from "./component/navbar";
import Header from "./component/header";
import { API_URL } from "./config/apiConfig";

function PermissionEdit() {
  const [selectedAccess, setSelectedAccess] = useState("");
  const [checked, setChecked] = useState({});
  const [rooms, setRooms] = useState([]);
  const [pages, setPages] = useState([]);
  const [access_rights, setAccessRights] = useState([]);
  const [editId, setEditId] = useState(null);
  const token = localStorage.getItem('token')

  useEffect(() => {
    getRooms();
    getPages();
    getAccessRight();
  }, []);

  // ✅ โหลดห้อง
  const getRooms = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/getRooms`, { headers: { Authorization: `Bearer ${token}` } });
      setRooms(res.data);
    } catch (err) {
      console.error("getRooms error:", err);
    }
  };

  // ✅ โหลดเพจ
  const getPages = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/getPageMenu`, { headers: { Authorization: `Bearer ${token}` } });
      setPages(res.data);
    } catch (err) {
      console.error("getPages error:", err);
    }
  };

  // ✅ โหลดสิทธิ์ทั้งหมด
  const getAccessRight = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/getUserAccessRight`, { headers: { Authorization: `Bearer ${token}` } });
      setAccessRights(res.data);
    } catch (err) {
      console.error("getAccess Rights error:", err);
    }
  };


  // ✅ toggle checkbox
  const handleCheck = (id) => {
    setChecked((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSelectAll = () => {
    const allKeys = {};

    // mark rooms เป็น true
    rooms.forEach(r => {
      allKeys['R' + r.ID] = true;
    });

    // mark pages เป็น true
    pages.forEach(p => {
      allKeys['P' + p.ID] = true;
    });

    setChecked(allKeys);
  };

  const handleClearAll = () => setChecked({});

  // ✅ เพิ่ม / แก้ไข
  const handleSave = async () => {
    if (!selectedAccess) {
      Swal.fire("แจ้งเตือน", "กรุณากรอกชื่อสิทธิ์", "warning");
      return;
    }

    // แยก rooms และ pages
    const selectedRooms = Object.keys(checked)
      .filter(k => checked[k] && k.startsWith('R')) // เฉพาะ R
      .map(k => parseInt(k.slice(1)));              // ตัดตัว R ออก

    const selectedPages = Object.keys(checked)
      .filter(k => checked[k] && k.startsWith('P')) // เฉพาะ P
      .map(k => parseInt(k.slice(1)));              // ตัดตัว P ออก

    if (selectedRooms.length === 0 && selectedPages.length === 0) {
      Swal.fire("แจ้งเตือน", "กรุณาเลือกห้องหรือหน้าเพจอย่างน้อย 1 รายการ", "warning");
      return;
    }

    const form = {
      roleName: selectedAccess,
      roomIds: selectedRooms,
      pageIds: selectedPages,
    };

    console.log(form);


    try {
      if (editId) {
        await axios.put(`${API_URL}/api/updateAccessRight/${editId}`, form, { headers: { Authorization: `Bearer ${token}` } });
        Swal.fire("Updated successfully!", "Access rights updated.", "success");
      } else {
        await axios.post(`${API_URL}/api/updateAccessRight`, form, { headers: { Authorization: `Bearer ${token}` } });
        Swal.fire("Successfully added!", "Access rights added.", "success");
      }

      resetForm();
      getAccessRight();
    } catch (err) {
      console.error("Save error:", err);
      Swal.fire("Something went wrong", "An error occurred recording.", "error");
    }
  };

  console.log(checked)

  // ✅ ดึงข้อมูลตอนกดแก้ไข
  const handleEdit = (idx) => {
    const row = access_rights[idx];

    setSelectedAccess(row.ARName);

    setChecked(() => {
      const newChecked = {};

      // ตรวจสอบ row.Pages ว่าเป็น array หรือไม่
      if (row.Pages.length > 0) {
        row.Pages.forEach(page => {
          if (page.PID != null) {
            newChecked['P' + page.PID] = true;
          }
        });
      }

      // ตรวจสอบ row.Rooms ว่าเป็น array หรือไม่
      if (row.Rooms.length > 0) {
        row.Rooms.forEach(room => {
          if (room.RID != null) {
            newChecked['R' + room.RID] = true;
          }
        });
      }

      setEditId(row.ARID);

      return newChecked;
    });
  };


  // ✅ ลบสิทธิ์
  const handleDelete = (id, name) => {
    Swal.fire({
      title: "Confirm deletion of access rights?",
      html: `<p>Want to delete access rights <b>${name}</b> or not?</p>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Confirm",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#2ecc71",
      cancelButtonColor: "#e74c3c",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await axios.delete(`${API_URL}/api/updateAccessRight/${id}`,{ headers: { Authorization: `Bearer ${token}` } });
          Swal.fire("Deleted Successfully", "Deleted Access Right Successfully", "success");
          getAccessRight();
        } catch (err) {
          const message =
            err.response?.data?.error || "An error occurred deleting";
          Swal.fire("Delete Failure", message, "error");
        }
      }
    });
  };

  const resetForm = () => {
    setSelectedAccess("");
    setChecked({});
    setEditId(null);
  };

  return (
    <div className={Permission.shell}>
      <Header />
      <div className={Permission.body}>
        <Navbar />
        <div className={Permission.container}>
          <h2 className={Permission.title}>จัดการสิทธิ์การเข้าถึง</h2>

          {/* ฟอร์มเพิ่มสิทธิ์ */}
          <div className={Permission.formWrapper}>
            <div className={Permission.selectRow}>
              <label>ชื่อสิทธิ์</label>
              <input
                type="text"
                value={selectedAccess}
                onChange={(e) => setSelectedAccess(e.target.value)}
              />
              <ul className={Permission.optionBtn}>
                <li onClick={handleSelectAll}>เลือกทั้งหมด</li>
                <li onClick={handleClearAll}>ล้างทั้งหมด</li>
              </ul>
            </div>

            {/* ตาราง checkbox ห้อง */}
            <div className={Permission.tableWrapper}>
              <div className={Permission.scrollContainer}>
                <table className={Permission.permissionTable}>
                  <thead>
                    <tr>
                      {pages.length != 0 ? <th colSpan={pages.length}>หน้าเพจ</th> : ''}
                      {rooms.length != 0 ? <th colSpan={rooms.length}>ห้อง</th> : ''}
                    </tr>
                    <tr>
                      {pages.map((page) => (
                        <th key={page.ID}>{page.NAME.toUpperCase()}</th>
                      ))}

                      {rooms.map((room) => (
                        <th key={room.ID}>{room.NAME.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {pages.map((page) => (
                        <td key={page.ID}>
                          <input
                            type="checkbox"
                            checked={!!checked['P' + page.ID]}
                            onChange={() => handleCheck('P' + page.ID)}
                          />
                        </td>
                      ))
                      }

                      {
                        rooms.map((room) => (
                          <td key={room.ID}>
                            <input
                              type="checkbox"
                              checked={!!checked['R' + room.ID]}
                              onChange={() => handleCheck('R' + room.ID)}
                            />
                          </td>
                        ))
                      }
                    </tr>
                  </tbody>
                </table>
              </div>

              <button className={Permission.saveBtn} onClick={handleSave}>
                {editId ? "อัปเดต" : "บันทึก"}
              </button>
              <button className={Permission.cancelBtn} onClick={resetForm}>
                ยกเลิก
              </button>
            </div>
          </div>

          {/* ตารางสิทธิ์ทั้งหมด */}
          <div className={Permission.dataTable}>
            <table className={Permission.permissionTable}>
              <thead>
                <tr>
                  <th>ชื่อสิทธิ์</th>
                  {pages.map((page) => (
                    <th key={page.ID}>{page.NAME.toUpperCase()}</th>
                  ))
                  }
                  {rooms.map((room) => (
                    <th key={room.ID}>{room.NAME.toUpperCase()}</th>
                  ))
                  }
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {access_rights.length !== 0 ? (
                  access_rights.map((access, idx) => (
                    <tr key={idx}>
                      <td>{access.ARName}</td>
                      {
                        pages.map((page) => (
                          <td>
                            <input
                              type="checkbox"
                              checked={access.Pages.some((accpage) => accpage.PID === page.ID)}
                              readOnly
                            />
                          </td>
                        ))
                      }

                      {
                        rooms.map((room) => (
                          <td>
                            <input
                              type="checkbox"
                              checked={access.Rooms.some((accroom) => accroom.RID === room.ID)}
                              readOnly
                            />
                          </td>
                        ))
                      }
                      <td>
                        <button
                          style={{
                            background: "orange",
                            color: "white",
                            border: "none",
                            padding: "5px 10px",
                            borderRadius: "4px",
                            marginRight: "5px",
                            cursor: "pointer",
                          }}
                          onClick={() => handleEdit(idx)}
                        >
                          แก้ไข
                        </button>
                        <button
                          style={{
                            background: "red",
                            color: "white",
                            border: "none",
                            padding: "5px 10px",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                          onClick={() => handleDelete(access.ARID, access.ARName)}
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={rooms.length + pages.length + 2} style={{ textAlign: "center" }}>
                      ยังไม่มีข้อมูล
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PermissionEdit;
