import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Building2,
  BriefcaseBusiness,
  ClipboardPenLine,
  Pencil,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { useAuth } from "../auth";
import { findLine, useOperations } from "../operations-context";
import {
  Button,
  DetailDrawer,
  KpiCard,
  PageHeader,
  SearchField,
  StatusBadge,
  WorkerChip,
} from "../components/ops-ui";
import type { DepartmentRecord, WorkerProfile } from "../types";

const EMPLOYEE_MANAGEMENT_PAGE_SIZE = 50;

type EmployeeFormState = {
  employeeCode: string;
  epfNo: string;
  fullName: string;
  departmentId: string;
  department: string;
  roleTitle: string;
  phone: string;
  shift: "Shift A" | "Shift B";
  hireDate: string;
  photoUrl: string;
  hrNotes: string;
};

type DepartmentFormState = {
  id: string | null;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
};

type ResignationFormState = {
  resignedAt: string;
  reason: string;
  hrNotes: string;
};

type EmploymentStatusFormState = {
  status: "active" | "inactive";
  reason: string;
  hrNotes: string;
};

type EmploymentStatusFilter = "All" | "active" | "inactive" | "resigned";

const DESIGNATION_OPTIONS = [
  "Machine Operator",
  "Production Helper",
  "Production Supervisor",
  "Quality Supervisor",
  "Piping Operator",
  "Marker Maker-CAD",
  "Packing Operator",
  "Cutting Operator",
  "Helper",
  "Team Member",
  "Store Keeper",
  "Mechanic",
  "Sample Operator",
];

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyEmployeeForm(): EmployeeFormState {
  return {
    employeeCode: "",
    epfNo: "",
    fullName: "",
    departmentId: "",
    department: "PRODUCTION",
    roleTitle: "Machine Operator",
    phone: "",
    shift: "Shift A",
    hireDate: todayInputValue(),
    photoUrl: "",
    hrNotes: "",
  };
}

function workerToEmployeeForm(worker: WorkerProfile): EmployeeFormState {
  return {
    employeeCode: worker.employeeId,
    epfNo: worker.epfNo || "",
    fullName: worker.fullName,
    departmentId: worker.departmentId || "",
    department: worker.department,
    roleTitle: worker.roleTitle,
    phone: worker.phone === "Not set" ? "" : worker.phone,
    shift: worker.shift,
    hireDate: worker.hireDate || worker.joinDate || "",
    photoUrl: worker.photoUrl || "",
    hrNotes: worker.hrNotes || "",
  };
}

function createEmptyDepartmentForm(): DepartmentFormState {
  return {
    id: null,
    code: "",
    name: "",
    description: "",
    isActive: true,
  };
}

function normalizeDepartmentCode(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function employmentTone(worker: WorkerProfile) {
  return normalizedEmploymentStatus(worker) === "resigned" ||
    normalizedEmploymentStatus(worker) === "inactive"
    ? "danger"
    : "success";
}

function employmentLabel(worker: WorkerProfile) {
  if (normalizedEmploymentStatus(worker) === "resigned") return "Resigned";
  if (normalizedEmploymentStatus(worker) === "inactive") return "Inactive";
  return "Active";
}

function normalizedEmploymentStatus(worker: WorkerProfile) {
  return worker.employmentStatus || "active";
}

export function EmployeeManagementPage() {
  const { currentUser } = useAuth();
  const {
    loading,
    error: operationsError,
    refresh,
    workers,
    employeeRoster,
    departments: departmentRecords,
    lines,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    createWorker,
    updateWorkerHrDetails,
    resignWorker,
    updateWorkerEmploymentStatus,
  } = useOperations();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All");
  const [employmentStatusFilter, setEmploymentStatusFilter] =
    useState<EmploymentStatusFilter>("All");
  const [page, setPage] = useState(1);
  const [drawerMode, setDrawerMode] = useState<
    "create" | "edit" | "resign" | "status" | "departments" | null
  >(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [employeeForm, setEmployeeForm] = useState<EmployeeFormState>(createEmptyEmployeeForm);
  const [departmentForm, setDepartmentForm] =
    useState<DepartmentFormState>(createEmptyDepartmentForm);
  const [resignationForm, setResignationForm] = useState<ResignationFormState>({
    resignedAt: todayInputValue(),
    reason: "",
    hrNotes: "",
  });
  const [employmentStatusForm, setEmploymentStatusForm] =
    useState<EmploymentStatusFormState>({
      status: "inactive",
      reason: "",
      hrNotes: "",
    });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const rosterWorkers = employeeRoster.length > 0 ? employeeRoster : workers;
  const activeWorkers = useMemo(
    () =>
      rosterWorkers.filter((worker) => normalizedEmploymentStatus(worker) === "active"),
    [rosterWorkers]
  );
  const inactiveWorkers = useMemo(
    () => rosterWorkers.filter((worker) => normalizedEmploymentStatus(worker) === "inactive"),
    [rosterWorkers]
  );
  const resignedWorkers = useMemo(
    () => rosterWorkers.filter((worker) => normalizedEmploymentStatus(worker) === "resigned"),
    [rosterWorkers]
  );
  const derivedDepartmentNames = useMemo(
    () =>
      Array.from(new Set(rosterWorkers.map((worker) => worker.department).filter(Boolean))).sort(),
    [rosterWorkers]
  );
  const departmentOptions = useMemo<DepartmentRecord[]>(() => {
    if (departmentRecords.length > 0) {
      return [...departmentRecords].sort((a, b) => a.name.localeCompare(b.name));
    }

    return derivedDepartmentNames.map((name) => ({
      id: `derived:${name}`,
      code: normalizeDepartmentCode(name),
      name,
      isActive: true,
      activeEmployees: activeWorkers.filter((worker) => worker.department === name).length,
    }));
  }, [activeWorkers, departmentRecords, derivedDepartmentNames]);
  const activeDepartmentOptions = useMemo(
    () => departmentOptions.filter((item) => item.isActive !== false),
    [departmentOptions]
  );
  const departmentFilterOptions = useMemo(
    () => ["All", ...new Set([...departmentOptions.map((item) => item.name), ...derivedDepartmentNames])],
    [departmentOptions, derivedDepartmentNames]
  );
  const designationOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...DESIGNATION_OPTIONS,
          ...rosterWorkers.map((worker) => worker.roleTitle).filter(Boolean),
        ])
      ).sort(),
    [rosterWorkers]
  );
  const selectedWorker = useMemo(
    () => rosterWorkers.find((worker) => worker.id === selectedWorkerId),
    [selectedWorkerId, rosterWorkers]
  );

  const filteredWorkers = useMemo(
    () =>
      rosterWorkers.filter((worker) => {
        const query = search.trim().toLowerCase();
        const line = findLine(lines, worker.currentLineId);
        const matchesQuery =
          !query ||
          worker.fullName.toLowerCase().includes(query) ||
          worker.employeeId.toLowerCase().includes(query) ||
          (worker.epfNo || "").toLowerCase().includes(query) ||
          worker.roleTitle.toLowerCase().includes(query) ||
          worker.department.toLowerCase().includes(query) ||
          (line?.name || "").toLowerCase().includes(query);
        const matchesDepartment = department === "All" || worker.department === department;
        const matchesEmploymentStatus =
          employmentStatusFilter === "All" ||
          normalizedEmploymentStatus(worker) === employmentStatusFilter;
        return matchesQuery && matchesDepartment && matchesEmploymentStatus;
      }),
    [department, employmentStatusFilter, lines, rosterWorkers, search]
  );

  const totalPages = Math.max(1, Math.ceil(filteredWorkers.length / EMPLOYEE_MANAGEMENT_PAGE_SIZE));
  const pagedWorkers = useMemo(() => {
    const start = (page - 1) * EMPLOYEE_MANAGEMENT_PAGE_SIZE;
    return filteredWorkers.slice(start, start + EMPLOYEE_MANAGEMENT_PAGE_SIZE);
  }, [filteredWorkers, page]);
  const employeeStart =
    filteredWorkers.length === 0 ? 0 : (page - 1) * EMPLOYEE_MANAGEMENT_PAGE_SIZE + 1;
  const employeeEnd = Math.min(page * EMPLOYEE_MANAGEMENT_PAGE_SIZE, filteredWorkers.length);
  const assignedWorkers = activeWorkers.filter((worker) => worker.currentLineId).length;
  const workersMissingCoreDetails = rosterWorkers.filter(
    (worker) => !worker.epfNo || !worker.phone || worker.phone === "Not set"
  ).length;

  useEffect(() => {
    setPage(1);
  }, [department, employmentStatusFilter, search]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const closeDrawer = () => {
    setDrawerMode(null);
    setSelectedWorkerId(null);
    setSaving(false);
  };

  const openCreateDrawer = () => {
    setFeedback(null);
    setSelectedWorkerId(null);
    const defaultDepartment = activeDepartmentOptions[0];
    setEmployeeForm({
      ...createEmptyEmployeeForm(),
      departmentId: defaultDepartment?.id || "",
      department: defaultDepartment?.name || "PRODUCTION",
    });
    setDrawerMode("create");
  };

  const openDepartmentDrawer = () => {
    setFeedback(null);
    setDepartmentForm(createEmptyDepartmentForm());
    setDrawerMode("departments");
  };

  const openEditDrawer = (worker: WorkerProfile) => {
    setFeedback(null);
    setSelectedWorkerId(worker.id);
    setEmployeeForm(workerToEmployeeForm(worker));
    setDrawerMode("edit");
  };

  const openResignDrawer = (worker: WorkerProfile) => {
    setFeedback(null);
    setSelectedWorkerId(worker.id);
    setResignationForm({
      resignedAt: todayInputValue(),
      reason: "",
      hrNotes: "",
    });
    setDrawerMode("resign");
  };

  const openStatusDrawer = (worker: WorkerProfile, status: EmploymentStatusFormState["status"]) => {
    setFeedback(null);
    setSelectedWorkerId(worker.id);
    setEmploymentStatusForm({
      status,
      reason: "",
      hrNotes: "",
    });
    setDrawerMode("status");
  };

  const updateEmployeeForm = <K extends keyof EmployeeFormState>(
    key: K,
    value: EmployeeFormState[K]
  ) => {
    setEmployeeForm((current) => ({ ...current, [key]: value }));
  };

  const selectDepartmentForEmployee = (value: string) => {
    const selectedDepartment = departmentOptions.find(
      (item) => item.id === value || item.name === value
    );
    const persistedDepartment = departmentRecords.some(
      (item) => item.id === selectedDepartment?.id
    );
    setEmployeeForm((current) => ({
      ...current,
      departmentId: persistedDepartment ? selectedDepartment?.id || "" : "",
      department: selectedDepartment?.name || value,
    }));
  };

  const updateDepartmentForm = <K extends keyof DepartmentFormState>(
    key: K,
    value: DepartmentFormState[K]
  ) => {
    setDepartmentForm((current) => ({ ...current, [key]: value }));
  };

  const editDepartmentRecord = (departmentRecord: DepartmentRecord) => {
    const persistedDepartment = departmentRecords.some((item) => item.id === departmentRecord.id);
    setFeedback(null);
    setDepartmentForm({
      id: persistedDepartment ? departmentRecord.id : null,
      code: departmentRecord.code,
      name: departmentRecord.name,
      description: departmentRecord.description || "",
      isActive: departmentRecord.isActive,
    });
  };

  const saveDepartment = async () => {
    const name = departmentForm.name.trim();
    if (!name) {
      setFeedback("Department name is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: departmentForm.code.trim() || normalizeDepartmentCode(name),
        name,
        description: departmentForm.description.trim(),
        isActive: departmentForm.isActive,
        actor: currentUser.name,
      };
      const result = departmentForm.id
        ? await updateDepartment({
            departmentId: departmentForm.id,
            ...payload,
          })
        : await createDepartment(payload);

      setFeedback(result.message);
      if (result.ok) {
        setDepartmentForm(createEmptyDepartmentForm());
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDepartment = async (departmentRecord: DepartmentRecord) => {
    if (departmentRecord.activeEmployees > 0) {
      setFeedback(
        `${departmentRecord.name} has ${departmentRecord.activeEmployees} active employee(s). Move those employees before deactivating this department.`
      );
      return;
    }

    setSaving(true);
    try {
      const result = await deleteDepartment({
        departmentId: departmentRecord.id,
        actor: currentUser.name,
      });
      setFeedback(result.message);
      if (result.ok && departmentForm.id === departmentRecord.id) {
        setDepartmentForm(createEmptyDepartmentForm());
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEmployee = async () => {
    setSaving(true);
    try {
      const result =
        drawerMode === "edit" && selectedWorker
          ? await updateWorkerHrDetails({
              workerId: selectedWorker.id,
              ...employeeForm,
              actor: currentUser.name,
            })
          : await createWorker({
              ...employeeForm,
              actor: currentUser.name,
            });

      setFeedback(result.message);
      if (result.ok) {
        closeDrawer();
      }
    } finally {
      setSaving(false);
    }
  };

  const saveResignation = async () => {
    if (!selectedWorker) return;
    setSaving(true);
    try {
      const result = await resignWorker({
        workerId: selectedWorker.id,
        resignedAt: resignationForm.resignedAt,
        reason: resignationForm.reason,
        hrNotes: resignationForm.hrNotes,
        actor: currentUser.name,
      });

      setFeedback(result.message);
      if (result.ok) {
        closeDrawer();
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEmploymentStatus = async () => {
    if (!selectedWorker) return;
    if (employmentStatusForm.status === "inactive" && !employmentStatusForm.reason.trim()) {
      setFeedback("Inactive reason is required.");
      return;
    }

    setSaving(true);
    try {
      const result = await updateWorkerEmploymentStatus({
        workerId: selectedWorker.id,
        status: employmentStatusForm.status,
        reason: employmentStatusForm.reason,
        hrNotes: employmentStatusForm.hrNotes,
        actor: currentUser.name,
      });

      setFeedback(result.message);
      if (result.ok) {
        closeDrawer();
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedActiveDepartmentOption = activeDepartmentOptions.find(
    (departmentRecord) =>
      departmentRecord.id === employeeForm.departmentId ||
      departmentRecord.name === employeeForm.department
  );
  const employeeDepartmentSelectValue =
    selectedActiveDepartmentOption?.id || employeeForm.department || "";

  return (
    <div className="ops-page">
      <PageHeader
        title="Employee Management"
        subtitle="HR roster controls for onboarding, master-data corrections, and resignations."
        actions={
          <>
            <Button tone="secondary" onClick={openDepartmentDrawer}>
              <Building2 size={15} />
              Departments
            </Button>
            <Button onClick={openCreateDrawer}>
              <UserPlus size={15} />
              Add Employee
            </Button>
          </>
        }
      />

      {feedback ? <div className="ops-alert-banner">{feedback}</div> : null}
      {operationsError ? (
        <div className="ops-alert-banner tone-danger">
          <div>
            Employee roster could not be loaded. {operationsError}
          </div>
          <button
            type="button"
            className="ops-link-button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      ) : null}

      <section className="ops-kpi-grid">
        <KpiCard
          label="Active Employees"
          value={`${activeWorkers.length}`}
          meta="Employees currently available across attendance, line, and reporting views."
          icon={Users}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Line Assigned"
          value={`${assignedWorkers}`}
          meta="Active employees linked to a production line."
          icon={BriefcaseBusiness}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Inactive"
          value={`${inactiveWorkers.length}`}
          meta="Employees temporarily removed from active counts and assignments."
          icon={UserX}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
        <KpiCard
          label="Resigned"
          value={`${resignedWorkers.length}`}
          meta="Employees removed from the active roster with resignation history kept."
          icon={UserMinus}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
        <KpiCard
          label="Needs HR Details"
          value={`${workersMissingCoreDetails}`}
          meta="Employees missing EPF or phone information."
          icon={ClipboardPenLine}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
      </section>

      <div className="ops-filter-bar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search by employee number, EPF, name, department, role, or line"
        />
        <select
          className="ops-select"
          style={{ flex: "0 0 210px" }}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        >
          {departmentFilterOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          className="ops-select"
          style={{ flex: "0 0 180px" }}
          value={employmentStatusFilter}
          onChange={(event) =>
            setEmploymentStatusFilter(event.target.value as EmploymentStatusFilter)
          }
        >
          <option value="All">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="resigned">Resigned</option>
        </select>
      </div>

      <section className="ops-table-card">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>EPF / Phone</th>
                <th>Department / Role</th>
                <th>Current Line</th>
                <th>Shift</th>
                <th>Employment</th>
                <th>HR Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedWorkers.map((worker) => (
                <tr key={worker.id}>
                  <td>
                    <WorkerChip
                      worker={worker}
                      meta={<div className="ops-row-subtitle">{worker.employeeId}</div>}
                    />
                  </td>
                  <td>
                    <div className="ops-row-title">{worker.epfNo || "No EPF"}</div>
                    <div className="ops-row-subtitle">{worker.phone}</div>
                  </td>
                  <td>
                    <div className="ops-row-title">{worker.department}</div>
                    <div className="ops-row-subtitle">{worker.roleTitle}</div>
                  </td>
                  <td>{findLine(lines, worker.currentLineId)?.name || "Unassigned"}</td>
                  <td>{worker.shift}</td>
                  <td>
                    <StatusBadge label={employmentLabel(worker)} tone={employmentTone(worker)} />
                  </td>
                  <td>
                    <div className="ops-row-actions">
                      <Link to={`/workers/${worker.id}`} className="ops-link-button">
                        Profile
                      </Link>
                      <button
                        type="button"
                        className="ops-link-button"
                        onClick={() => openEditDrawer(worker)}
                      >
                        Edit HR
                      </button>
                      {normalizedEmploymentStatus(worker) === "inactive" ? (
                        <button
                          type="button"
                          className="ops-link-button"
                          onClick={() => openStatusDrawer(worker, "active")}
                        >
                          Activate
                        </button>
                      ) : normalizedEmploymentStatus(worker) !== "resigned" ? (
                        <button
                          type="button"
                          className="ops-link-button"
                          onClick={() => openStatusDrawer(worker, "inactive")}
                        >
                          Mark Inactive
                        </button>
                      ) : null}
                      {normalizedEmploymentStatus(worker) !== "resigned" ? (
                        <button
                          type="button"
                          className="ops-link-button"
                          onClick={() => openResignDrawer(worker)}
                        >
                          Resign
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ops-pagination-bar">
          <div className="ops-row-subtitle">
            Showing {employeeStart}-{employeeEnd} of {filteredWorkers.length} employees
          </div>
          <div className="ops-pagination-actions">
            <button
              type="button"
              className="ops-button ops-button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span className="ops-pagination-count">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="ops-button ops-button-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <DetailDrawer
        open={drawerMode === "create" || drawerMode === "edit"}
        title={drawerMode === "edit" ? "Edit Employee HR Details" : "Add New Employee"}
        subtitle={
          drawerMode === "edit"
            ? "Update master roster details used by attendance, reports, and line views."
            : "Create an active employee record for attendance and workforce visibility."
        }
        onClose={closeDrawer}
        footer={
          <>
            <Button tone="secondary" onClick={closeDrawer} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEmployee} disabled={saving}>
              <UserPlus size={15} />
              {saving ? "Saving..." : drawerMode === "edit" ? "Save Changes" : "Add Employee"}
            </Button>
          </>
        }
      >
        <div className="ops-grid cols-2">
          <label className="ops-form-field">
            <span className="ops-filter-label">Employee number</span>
            <input
              className="ops-input"
              value={employeeForm.employeeCode}
              onChange={(event) => updateEmployeeForm("employeeCode", event.target.value)}
              placeholder="e.g. 22541"
            />
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">EPF number</span>
            <input
              className="ops-input"
              value={employeeForm.epfNo}
              onChange={(event) => updateEmployeeForm("epfNo", event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Full name</span>
            <input
              className="ops-input"
              value={employeeForm.fullName}
              onChange={(event) => updateEmployeeForm("fullName", event.target.value)}
              placeholder="Employee full name"
            />
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Department</span>
            <select
              className="ops-select"
              value={employeeDepartmentSelectValue}
              onChange={(event) => selectDepartmentForEmployee(event.target.value)}
            >
              <option value="">Select department</option>
              {activeDepartmentOptions.map((departmentRecord) => (
                <option key={departmentRecord.id} value={departmentRecord.id}>
                  {departmentRecord.name}
                </option>
              ))}
              {employeeForm.department &&
              !activeDepartmentOptions.some(
                (departmentRecord) =>
                  departmentRecord.id === employeeForm.departmentId ||
                  departmentRecord.name === employeeForm.department
              ) ? (
                <option value={employeeForm.department}>{employeeForm.department}</option>
              ) : null}
            </select>
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Designation / role</span>
            <select
              className="ops-select"
              value={employeeForm.roleTitle}
              onChange={(event) => updateEmployeeForm("roleTitle", event.target.value)}
            >
              {employeeForm.roleTitle && !designationOptions.includes(employeeForm.roleTitle) ? (
                <option value={employeeForm.roleTitle}>{employeeForm.roleTitle}</option>
              ) : null}
              {designationOptions.map((designation) => (
                <option key={designation} value={designation}>
                  {designation}
                </option>
              ))}
            </select>
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Phone</span>
            <input
              className="ops-input"
              value={employeeForm.phone}
              onChange={(event) => updateEmployeeForm("phone", event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Shift</span>
            <select
              className="ops-select"
              value={employeeForm.shift}
              onChange={(event) =>
                updateEmployeeForm("shift", event.target.value as EmployeeFormState["shift"])
              }
            >
              <option value="Shift A">Shift A</option>
              <option value="Shift B">Shift B</option>
            </select>
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Hire date</span>
            <input
              className="ops-input"
              type="date"
              value={employeeForm.hireDate}
              onChange={(event) => updateEmployeeForm("hireDate", event.target.value)}
            />
          </label>
          <label className="ops-form-field" style={{ gridColumn: "1 / -1" }}>
            <span className="ops-filter-label">Employee image URL</span>
            <input
              className="ops-input"
              value={employeeForm.photoUrl}
              onChange={(event) => updateEmployeeForm("photoUrl", event.target.value)}
              placeholder="Optional image URL"
            />
          </label>
          <label className="ops-form-field" style={{ gridColumn: "1 / -1" }}>
            <span className="ops-filter-label">HR note</span>
            <textarea
              className="ops-input"
              rows={4}
              value={employeeForm.hrNotes}
              onChange={(event) => updateEmployeeForm("hrNotes", event.target.value)}
              placeholder="Contract, onboarding, or roster notes"
            />
          </label>
        </div>
      </DetailDrawer>

      <DetailDrawer
        open={drawerMode === "departments"}
        title="Department Management"
        subtitle="Maintain the department master list used by employee profiles, filters, and reports."
        onClose={closeDrawer}
        footer={
          <>
            <Button tone="secondary" onClick={closeDrawer} disabled={saving}>
              Close
            </Button>
            <Button onClick={saveDepartment} disabled={saving}>
              <Building2 size={15} />
              {saving
                ? "Saving..."
                : departmentForm.id
                  ? "Update Department"
                  : "Add Department"}
            </Button>
          </>
        }
      >
        <div className="ops-grid cols-2">
          <label className="ops-form-field">
            <span className="ops-filter-label">Department code</span>
            <input
              className="ops-input"
              value={departmentForm.code}
              onChange={(event) => updateDepartmentForm("code", event.target.value)}
              placeholder="e.g. PRODUCTION"
            />
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Department name</span>
            <input
              className="ops-input"
              value={departmentForm.name}
              onChange={(event) => {
                const nextName = event.target.value;
                setDepartmentForm((current) => ({
                  ...current,
                  name: nextName,
                  code: current.code || normalizeDepartmentCode(nextName),
                }));
              }}
              placeholder="e.g. Production"
            />
          </label>
          <label className="ops-form-field" style={{ gridColumn: "1 / -1" }}>
            <span className="ops-filter-label">Description</span>
            <textarea
              className="ops-input"
              rows={3}
              value={departmentForm.description}
              onChange={(event) => updateDepartmentForm("description", event.target.value)}
              placeholder="Optional HR description, ownership, or notes"
            />
          </label>
          <label className="ops-form-field" style={{ gridColumn: "1 / -1" }}>
            <span className="ops-filter-label">Status</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={departmentForm.isActive}
                onChange={(event) => updateDepartmentForm("isActive", event.target.checked)}
              />
              Active department
            </span>
          </label>
        </div>

        <div className="ops-table-card" style={{ marginTop: 18 }}>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Active Employees</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {departmentOptions.map((departmentRecord) => (
                  <tr key={departmentRecord.id}>
                    <td>
                      <div className="ops-row-title">{departmentRecord.name}</div>
                      <div className="ops-row-subtitle">{departmentRecord.code}</div>
                    </td>
                    <td>{departmentRecord.description || "No description"}</td>
                    <td>
                      <StatusBadge
                        label={departmentRecord.isActive ? "Active" : "Inactive"}
                        tone={departmentRecord.isActive ? "success" : "danger"}
                      />
                    </td>
                    <td>{departmentRecord.activeEmployees}</td>
                    <td>
                      <div className="ops-row-actions">
                        <button
                          type="button"
                          className="ops-link-button"
                          onClick={() => editDepartmentRecord(departmentRecord)}
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        {departmentRecord.isActive ? (
                          <button
                            type="button"
                            className="ops-link-button tone-danger"
                            disabled={saving}
                            onClick={() => void handleDeleteDepartment(departmentRecord)}
                          >
                            <Trash2 size={14} />
                            Deactivate
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {departmentOptions.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No departments have been created yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </DetailDrawer>

      <DetailDrawer
        open={drawerMode === "resign"}
        title="Mark Employee as Resigned"
        subtitle={
          selectedWorker
            ? `${selectedWorker.fullName} will be removed from active dashboards and line assignments.`
            : "Remove employee from the active roster."
        }
        onClose={closeDrawer}
        footer={
          <>
            <Button tone="secondary" onClick={closeDrawer} disabled={saving}>
              Cancel
            </Button>
            <Button tone="danger" onClick={saveResignation} disabled={saving || !selectedWorker}>
              <UserMinus size={15} />
              {saving ? "Saving..." : "Confirm Resignation"}
            </Button>
          </>
        }
      >
        <div className="ops-grid cols-2">
          <label className="ops-form-field">
            <span className="ops-filter-label">Resignation date</span>
            <input
              className="ops-input"
              type="date"
              value={resignationForm.resignedAt}
              onChange={(event) =>
                setResignationForm((current) => ({
                  ...current,
                  resignedAt: event.target.value,
                }))
              }
            />
          </label>
          <label className="ops-form-field">
            <span className="ops-filter-label">Reason</span>
            <input
              className="ops-input"
              value={resignationForm.reason}
              onChange={(event) =>
                setResignationForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              placeholder="Resigned, terminated, contract ended..."
            />
          </label>
          <label className="ops-form-field" style={{ gridColumn: "1 / -1" }}>
            <span className="ops-filter-label">HR note</span>
            <textarea
              className="ops-input"
              rows={4}
              value={resignationForm.hrNotes}
              onChange={(event) =>
                setResignationForm((current) => ({
                  ...current,
                  hrNotes: event.target.value,
                }))
              }
              placeholder="Final settlement, handover, or clearance notes"
            />
          </label>
        </div>
        <div className="ops-alert-banner">
          This keeps historical attendance and audit records, but removes the employee from active
          counts and closes active line assignments.
        </div>
      </DetailDrawer>

      <DetailDrawer
        open={drawerMode === "status"}
        title={
          employmentStatusForm.status === "active"
            ? "Reactivate Employee"
            : "Mark Employee as Inactive"
        }
        subtitle={
          selectedWorker
            ? employmentStatusForm.status === "active"
              ? `${selectedWorker.fullName} will return to the active HR roster.`
              : `${selectedWorker.fullName} will be removed from active dashboards and line assignments.`
            : "Update employee employment status."
        }
        onClose={closeDrawer}
        footer={
          <>
            <Button tone="secondary" onClick={closeDrawer} disabled={saving}>
              Cancel
            </Button>
            <Button
              tone={employmentStatusForm.status === "active" ? "primary" : "danger"}
              onClick={saveEmploymentStatus}
              disabled={saving || !selectedWorker}
            >
              {employmentStatusForm.status === "active" ? (
                <UserCheck size={15} />
              ) : (
                <UserX size={15} />
              )}
              {saving
                ? "Saving..."
                : employmentStatusForm.status === "active"
                  ? "Activate Employee"
                  : "Confirm Inactive"}
            </Button>
          </>
        }
      >
        <div className="ops-grid cols-2">
          <label className="ops-form-field" style={{ gridColumn: "1 / -1" }}>
            <span className="ops-filter-label">
              {employmentStatusForm.status === "active"
                ? "Reactivation note"
                : "Inactive reason"}
            </span>
            <input
              className="ops-input"
              value={employmentStatusForm.reason}
              onChange={(event) =>
                setEmploymentStatusForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              placeholder={
                employmentStatusForm.status === "active"
                  ? "Returned to work, HR verified, contract restored..."
                  : "Three unapproved absences, suspended, temporary hold..."
              }
            />
          </label>
          <label className="ops-form-field" style={{ gridColumn: "1 / -1" }}>
            <span className="ops-filter-label">HR note</span>
            <textarea
              className="ops-input"
              rows={4}
              value={employmentStatusForm.hrNotes}
              onChange={(event) =>
                setEmploymentStatusForm((current) => ({
                  ...current,
                  hrNotes: event.target.value,
                }))
              }
              placeholder="Verification, follow-up owner, or supporting notes"
            />
          </label>
        </div>
        <div className="ops-alert-banner">
          Inactive employees are excluded from active attendance and line counts. Historical
          attendance, notes, and audit records remain available.
        </div>
      </DetailDrawer>
    </div>
  );
}

export default EmployeeManagementPage;
