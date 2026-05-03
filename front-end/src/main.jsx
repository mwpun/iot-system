
import { StrictMode,  lazy, Suspense  } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";

import PatientVitalsDashboard from "./PatientVitalsDashboard.jsx"
import Account from "./Account.jsx"
import AccountForm from "./Account_Form.jsx"
import LoginPage from "./LoginPage.jsx"
import ProtectedRoute from './component/routerguard.jsx';
import PermissionEdit from './PermissionEdit.jsx'
import AlertsPage from './AlertsPage.jsx'
import AddGrafanaUrl from './AddGrafanaUrl.jsx'
import DataTimeline from './PatientDataTimeline.jsx'
import ConfigSensorAlert from './ConfigSensorAlert.jsx'

const router = createBrowserRouter([
  {
    path: "/",
    element: <ProtectedRoute>
      <PatientVitalsDashboard/>
    </ProtectedRoute>
  },
   {
    path: "/Login",
    element: <LoginPage/>
  },
  {
    path: "/Account",
    element: <ProtectedRoute>
      <Account/>
    </ProtectedRoute>
  },
  {
    path: "/AccountForm",
    element: <ProtectedRoute>
      <AccountForm/>
    </ProtectedRoute>
  },
  {
    path: "/AccountForm/:id",
    element: <ProtectedRoute>
      <AccountForm/>
    </ProtectedRoute>
  },

  {
    path: "/Permission",
    element: <ProtectedRoute>
      <PermissionEdit/>
    </ProtectedRoute>
  },
  {
    path: "/Alerts",
    element: <ProtectedRoute>
      <AlertsPage/>
    </ProtectedRoute>
  },
  {
    path: "/GrafanaUrl",
    element: <ProtectedRoute>
      <AddGrafanaUrl/>
    </ProtectedRoute>
  },
  {
    path: "/DataTimeline",
    element: <ProtectedRoute>
      <DataTimeline/>
    </ProtectedRoute>
  },
  {
    path: "/ConfigSensor",
    element: <ProtectedRoute>
      <ConfigSensorAlert/>
    </ProtectedRoute>
  },
  
  
]);



createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div>Loading...</div>}>
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>
)
