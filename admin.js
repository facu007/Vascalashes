/* ============================================================
   VASCA ADMIN - Agenda, Reseñas y Dashboard Operativo
   ============================================================ */
(function () {
  "use strict";

  const SUPABASE_URL = "https://mxoztaxlcciqrdejfpum.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14b3p0YXhsY2NpcXJkZWpmcHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTQ3NzksImV4cCI6MjA5NDE5MDc3OX0.bwE9e5P2UvqAC9VauZVk1q6j19mnDkAptXMOTEiKhJA";
  const adminToken = localStorage.getItem("vasca_token");
  const userRole = localStorage.getItem("vasca_role");

  if (!adminToken || userRole !== "admin") {
    window.location.href = "login.html";
    return;
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  let professionals = [];
  let services = [];
  let prices = [];
  let calendarDate = new Date();
  let selectedCalDay = null;
  let monthAppointments = [];
  let tomorrowAppts = [];
  let clientsCache = [];
  let loyaltyMap = new Map();
  let editingAppt = null;
  const charts = {};
  let currentWeeklySchedule = [];
  let uploadedBgImage = null;

  async function api(table, query = "", opts = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
    const response = await fetch(url, {
      headers: { ...headers, ...(opts.headers || {}) },
      method: opts.method || "GET",
      body: opts.body,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function invokeAppointmentEmail(appointmentId) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/appointment-email`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ appointmentId, type: "created" }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "No se pudo enviar el email");
    }
    return payload;
  }

  function today() {
    return new Date().toISOString().split("T")[0];
  }

  function formatDate(date) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  function formatTime(time) {
    return String(time || "").substring(0, 5);
  }

  function timeToMinutes(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function minutesToTime(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function statusLabel(status) {
    return {
      pending: "Pendiente",
      confirmed: "Confirmado",
      completed: "Completado",
      cancelled: "Cancelado",
      no_show: "No vino",
    }[status] || status;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setHeaderDate() {
    const now = new Date();
    document.getElementById("header-date").textContent = now.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function setupMobileMenu() {
    document.getElementById("menu-toggle").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("open");
    });
  }

  function setupNav() {
    document.querySelectorAll(".nav-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.view;
        document.querySelectorAll(".nav-btn").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
        document.getElementById(`view-${view}`).classList.add("active");
        document.getElementById("page-title").textContent = button.textContent.trim();
        document.getElementById("sidebar").classList.remove("open");

        if (view === "dashboard") loadDashboard();
        if (view === "calendar") renderCalendar();
        if (view === "clients") loadClients();
        if (view === "reviews") loadReviewsModeration();
        if (view === "settings") loadSettingsView();
      });
    });
  }

  async function loadDashboard() {
    ["stat-today", "stat-week", "stat-pending", "stat-clients"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.textContent = "—";
    });

    document.getElementById("today-appointments").innerHTML = "<div class='skeleton skeleton-card'></div><div class='skeleton skeleton-card'></div>";
    document.getElementById("tomorrow-reminders").innerHTML = "<div class='skeleton skeleton-card'></div><div class='skeleton skeleton-card'></div>";

    const todayStr = today();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    try {
      const [todayAppointments, weekAppointments, pendingAppointments, clientsCount, tomorrowAppointments] = await Promise.all([
        api("appointments", `select=*,clients(full_name,phone,instagram),professionals(name,color),services(name,duration_minutes)&appointment_date=eq.${todayStr}&status=neq.cancelled&order=start_time`),
        api("appointments", `select=id&appointment_date=gte.${weekStart.toISOString().split("T")[0]}&appointment_date=lte.${weekEnd.toISOString().split("T")[0]}&status=neq.cancelled`),
        api("appointments", "select=id&status=eq.pending"),
        api("clients", "select=id"),
        api("appointments", `select=*,clients(full_name,phone),professionals(name),services(name)&appointment_date=eq.${tomorrowStr}&status=neq.cancelled&order=start_time`),
      ]);

      tomorrowAppts = tomorrowAppointments;
      document.getElementById("stat-today").textContent = todayAppointments.length;
      document.getElementById("stat-week").textContent = weekAppointments.length;
      document.getElementById("stat-pending").textContent = pendingAppointments.length;
      document.getElementById("stat-clients").textContent = clientsCount.length;

      renderAppointmentsList("today-appointments", todayAppointments);
      renderReminders();
      loadCharts();
    } catch (error) {
      document.getElementById("today-appointments").innerHTML = `<p class="empty-msg">${error.message}</p>`;
      document.getElementById("tomorrow-reminders").innerHTML = "<p class='empty-msg'>No se pudieron cargar recordatorios</p>";
    }
  }

  function renderReminders() {
    const container = document.getElementById("tomorrow-reminders");
    const sent = JSON.parse(localStorage.getItem("vasca_reminders_sent") || "{}");

    if (!tomorrowAppts.length) {
      container.innerHTML = "<p class='empty-msg'>No hay turnos mañana</p>";
      document.getElementById("btn-send-all").style.display = "none";
      return;
    }

    document.getElementById("btn-send-all").style.display = "";
    container.innerHTML = tomorrowAppts.map((appointment) => {
      const name = appointment.clients?.full_name || "Clienta";
      const phone = appointment.clients?.phone || "";
      const serviceName = appointment.services?.name || "";
      const professionalName = appointment.professionals?.name || "";
      const wasSent = sent[appointment.id];

      return `
        <div class="appt-card" data-id="${appointment.id}">
          <div class="appt-time">${formatTime(appointment.start_time)}</div>
          <div class="appt-info">
            <h4>${escapeHtml(name)}</h4>
            <p>${escapeHtml(serviceName)} · ${escapeHtml(professionalName)}</p>
          </div>
          <div class="appt-actions">
            ${wasSent
              ? "<span class='appt-status status-confirmed'>Enviado</span>"
              : `<button class="action-btn" onclick="vasca.sendReminder('${appointment.id}','${phone.replace(/'/g, "\\'")}','${name.replace(/'/g, "\\'")}','${serviceName.replace(/'/g, "\\'")}','${appointment.appointment_date}','${appointment.start_time}')">Recordar</button>`}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderAppointmentsList(containerId, appointments) {
    const container = document.getElementById(containerId);
    if (!appointments.length) {
      container.innerHTML = "<p class='empty-msg'>No hay turnos</p>";
      return;
    }

    container.innerHTML = appointments.map((appointment) => {
      const clientName = (appointment.clients?.full_name || "Clienta").replace(/'/g, "\\'");
      const clientPhone = (appointment.clients?.phone || "").replace(/'/g, "\\'");
      const serviceName = (appointment.services?.name || "").replace(/'/g, "\\'");
      const professionalName = (appointment.professionals?.name || "").replace(/'/g, "\\'");
      return `
        <div class="appt-card" data-id="${appointment.id}">
          <div class="appt-time">${formatTime(appointment.start_time)}</div>
          <div class="appt-info">
            <h4>${escapeHtml(appointment.clients?.full_name || "Sin nombre")}</h4>
            <p>${escapeHtml(serviceName)} · ${escapeHtml(professionalName)}${appointment.clients?.instagram ? ` · ${escapeHtml(appointment.clients.instagram)}` : ""}</p>
          </div>
          <div class="appt-actions">
            <span class="appt-status status-${appointment.status}">${statusLabel(appointment.status)}</span>
            ${["pending", "confirmed"].includes(appointment.status) ? `<button class="action-btn" onclick="vasca.editAppt('${appointment.id}','${appointment.professional_id}','${appointment.service_id}','${appointment.appointment_date}','${appointment.start_time}','${clientPhone}','${clientName}','${serviceName}')">Modificar</button>` : ""}
            ${appointment.status === "confirmed" ? `<button class="action-btn" onclick="vasca.completeAppt('${appointment.id}')">Completar</button>` : ""}
            ${["pending", "confirmed"].includes(appointment.status) ? `<button class="action-btn danger" onclick="vasca.cancelAppt('${appointment.id}','${clientPhone}','${clientName}','${serviceName}','${appointment.appointment_date}','${appointment.start_time}')">Cancelar</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  async function loadCharts() {
    try {
      const [daily, load, status, kpisMonthly, services, clientStats] = await Promise.all([
        api("v_admin_daily_ops", "select=*"),
        api("v_admin_professional_load", "select=*"),
        api("v_admin_status_mix", "select=*"),
        api("v_admin_kpis_monthly", "select=*&order=month_id.asc"),
        api("v_admin_services_sold", "select=*"),
        api("v_admin_client_stats", "select=*&limit=1"),
      ]);

      const currentMonth = kpisMonthly && kpisMonthly.length ? kpisMonthly[kpisMonthly.length - 1] : null;
      if (currentMonth) {
        document.getElementById("stat-revenue").textContent = `$${Number(currentMonth.total_revenue).toLocaleString("es-AR")}`;
        document.getElementById("stat-ticket").textContent = `$${Number(currentMonth.average_ticket).toLocaleString("es-AR")}`;
        document.getElementById("stat-cancel").textContent = `${Number(currentMonth.cancellation_rate).toFixed(1)}%`;
      }
      
      const stats = clientStats?.[0];
      if (stats) {
        document.getElementById("stat-retention").textContent = `${Number(stats.retention_rate).toFixed(1)}%`;
      }

      if (!window.Chart) return;

      upsertChart("daily", "chart-daily", {
        type: "line",
        data: {
          labels: daily.map((row) => new Date(`${row.appointment_date}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short" })),
          datasets: [
            {
              label: "Turnos",
              data: daily.map((row) => row.total_appointments),
              borderColor: "#c9a88e",
              backgroundColor: "rgba(201,168,142,0.18)",
              tension: 0.35,
              fill: true,
            },
            {
              label: "Completados",
              data: daily.map((row) => row.completed_appointments),
              borderColor: "#6bcb77",
              backgroundColor: "rgba(107,203,119,0.12)",
              tension: 0.35,
            },
            {
              label: "Cancelados",
              data: daily.map((row) => row.cancelled_appointments),
              borderColor: "#ff6b6b",
              backgroundColor: "rgba(255,107,107,0.12)",
              tension: 0.35,
            },
          ],
        },
      });

      upsertChart("load", "chart-load", {
        type: "bar",
        data: {
          labels: load.map((row) => row.professional_name),
          datasets: [
            {
              label: "Ocupación %",
              data: load.map((row) => row.occupancy_pct),
              backgroundColor: ["#c9a88e", "#8f7769", "#d8c6b5"],
              borderRadius: 10,
            },
          ],
        },
      });

      upsertChart("revenue", "chart-revenue", {
        type: "bar",
        data: {
          labels: (kpisMonthly || []).map((row) => {
            const [y, m] = row.month_id.split("-");
            return new Date(y, m - 1, 1).toLocaleDateString("es-AR", { month: "short", year: "2-digit" });
          }),
          datasets: [
            {
              label: "Ingresos Brutos ($)",
              data: (kpisMonthly || []).map((row) => row.total_revenue),
              backgroundColor: "rgba(116,185,255,0.85)",
              borderRadius: 6,
            },
          ],
        },
      });

      upsertChart("services", "chart-services-sold", {
        type: "bar",
        options: { indexAxis: "y" },
        data: {
          labels: (services || []).slice(0, 5).map((row) => row.service_name),
          datasets: [
            {
              label: "Cantidad",
              data: (services || []).slice(0, 5).map((row) => row.times_sold),
              backgroundColor: "#6bcb77",
              borderRadius: 6,
            },
          ],
        },
      });

      upsertChart("clients", "chart-clients", {
        type: "doughnut",
        data: {
          labels: ["Nuevas", "Recurrentes"],
          datasets: [
            {
              data: stats ? [stats.new_clients, stats.recurring_clients] : [0, 0],
              backgroundColor: ["#74b9ff", "#c9a88e"],
              borderWidth: 0,
            },
          ],
        },
      });

      upsertChart("status", "chart-status", {
        type: "doughnut",
        data: {
          labels: status.map((row) => statusLabel(row.status)),
          datasets: [
            {
              data: status.map((row) => row.total_appointments),
              backgroundColor: ["#ffd93d", "#6bcb77", "#74b9ff", "#ff6b6b", "#8a7a6c"],
              borderWidth: 0,
            },
          ],
        },
      });
    } catch (error) {
      console.error("Error cargando gráficos:", error.message || error);
      ["daily", "load", "revenue", "services", "clients", "status"].forEach((key) => {
        if (charts[key]) {
          charts[key].destroy();
          charts[key] = null;
        }
      });
    }
  }

  function upsertChart(key, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (charts[key]) charts[key].destroy();

    charts[key] = new Chart(canvas, {
      ...config,
      options: {
        ...(config.options || {}),
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: "#f5efe8" },
          },
        },
        scales: config.type === "doughnut" ? {} : {
          x: {
            ticks: { color: "#8a7a6c" },
            grid: { color: "rgba(255,245,235,0.06)" },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#8a7a6c" },
            grid: { color: "rgba(255,245,235,0.06)" },
          },
        },
      },
    });
  }

  async function updateStatus(id, status) {
    const body = { status };
    if (status === "confirmed") body.confirmed_at = new Date().toISOString();
    if (status === "cancelled") body.cancelled_at = new Date().toISOString();

    await api("appointments", `id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    loadDashboard();
    if (document.getElementById("view-calendar").classList.contains("active")) renderCalendar();
    if (document.getElementById("view-clients").classList.contains("active")) loadClients();
  }

  async function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    document.getElementById("cal-month-label").textContent = firstDay.toLocaleDateString("es-AR", {
      month: "long",
      year: "numeric",
    });

    const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const endStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
    monthAppointments = await api("appointments", `select=id,professional_id,service_id,appointment_date,start_time,status,clients(full_name,phone,instagram),professionals(name,color),services(name)&appointment_date=gte.${startStr}&appointment_date=lte.${endStr}&status=neq.cancelled&order=start_time`);

    const grid = document.getElementById("calendar-grid");
    const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    let html = dayNames.map((day) => `<div class="cal-header">${day}</div>`).join("");

    const startPad = (firstDay.getDay() + 6) % 7;
    const prevMonth = new Date(year, month, 0);

    for (let i = startPad - 1; i >= 0; i -= 1) {
      const day = prevMonth.getDate() - i;
      html += `<div class="cal-day other-month"><span class="day-num">${day}</span></div>`;
    }

    const todayStr = today();
    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const count = monthAppointments.filter((appointment) => appointment.appointment_date === dateStr).length;
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === selectedCalDay;

      html += `<div class="cal-day${isToday ? " today" : ""}${isSelected ? " selected" : ""}" data-date="${dateStr}">
        <span class="day-num">${day}</span>
        ${count ? `<span class="day-count">${count}</span>` : ""}
      </div>`;
    }

    const endPad = (7 - ((startPad + lastDay.getDate()) % 7)) % 7;
    for (let day = 1; day <= endPad; day += 1) {
      html += `<div class="cal-day other-month"><span class="day-num">${day}</span></div>`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll(".cal-day:not(.other-month)").forEach((dayCell) => {
      dayCell.addEventListener("click", () => {
        selectedCalDay = dayCell.dataset.date;
        renderCalendar();
        showDayDetail(selectedCalDay);
      });
    });

    if (selectedCalDay) showDayDetail(selectedCalDay);

    document.getElementById("cal-prev").onclick = () => {
      calendarDate.setMonth(calendarDate.getMonth() - 1);
      renderCalendar();
    };

    document.getElementById("cal-next").onclick = () => {
      calendarDate.setMonth(calendarDate.getMonth() + 1);
      renderCalendar();
    };
  }

  function showDayDetail(dateStr) {
    const appointments = monthAppointments.filter((appointment) => appointment.appointment_date === dateStr);
    document.getElementById("day-detail-panel").style.display = "block";
    document.getElementById("day-detail-title").textContent = formatDate(dateStr);
    renderAppointmentsList("day-appointments", appointments);
  }

  function populateFormSelects() {
    const professionalSelect = document.getElementById("f-professional");
    const serviceSelect = document.getElementById("f-service");

    professionals.forEach((professional) => {
      professionalSelect.innerHTML += `<option value="${professional.id}">${professional.name}</option>`;
    });

    services.forEach((service) => {
      serviceSelect.innerHTML += `<option value="${service.id}" data-duration="${service.duration_minutes}">${service.name} (${service.duration_minutes} min)</option>`;
    });

    document.getElementById("f-date").min = today();
  }

  function setupFormListeners() {
    ["f-date", "f-professional", "f-service"].forEach((id) => {
      document.getElementById(id).addEventListener("change", loadAvailableSlots);
    });
    document.getElementById("appointment-form").addEventListener("submit", submitAppointment);
  }

  async function loadAvailableSlots() {
    const timeSelect = document.getElementById("f-time");
    const dateValue = document.getElementById("f-date").value;
    const professionalId = document.getElementById("f-professional").value;
    const serviceSelect = document.getElementById("f-service");
    const serviceId = serviceSelect.value;

    if (!dateValue || !professionalId || !serviceId) {
      timeSelect.innerHTML = "<option value=''>Completar campos anteriores</option>";
      return;
    }

    const duration = parseInt(serviceSelect.selectedOptions[0].dataset.duration, 10) || 60;
    const dbDayOfWeek = new Date(`${dateValue}T12:00:00`).getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
    const [schedule, existing, blocked] = await Promise.all([
      api("weekly_schedule", `select=*&professional_id=eq.${professionalId}&day_of_week=eq.${dbDayOfWeek}&is_active=eq.true`),
      api("appointments", `select=start_time,end_time&professional_id=eq.${professionalId}&appointment_date=eq.${dateValue}&status=neq.cancelled`),
      api("blocked_dates", `select=id&blocked_date=eq.${dateValue}&or=(professional_id.eq.${professionalId},professional_id.is.null)`),
    ]);

    if (blocked.length) {
      timeSelect.innerHTML = "<option value=''>Día bloqueado</option>";
      return;
    }

    if (!schedule.length) {
      timeSelect.innerHTML = "<option value=''>No hay horario ese día</option>";
      return;
    }

    const sched = schedule[0];
    const slots = [];
    let current = timeToMinutes(sched.start_time);
    const end = timeToMinutes(sched.end_time);
    const breakStart = sched.break_start ? timeToMinutes(sched.break_start) : null;
    const breakEnd = sched.break_end ? timeToMinutes(sched.break_end) : null;

    while (current + duration <= end) {
      const slotEnd = current + duration;
      if (breakStart !== null && breakEnd !== null && current < breakEnd && slotEnd > breakStart) {
        current = breakEnd;
        continue;
      }

      const overlap = existing.some((appointment) => {
        const start = timeToMinutes(appointment.start_time);
        const finish = timeToMinutes(appointment.end_time);
        return current < finish && slotEnd > start;
      });

      if (!overlap) slots.push(minutesToTime(current));
      current += 30;
    }

    if (!slots.length) {
      timeSelect.innerHTML = "<option value=''>Sin horarios disponibles</option>";
      return;
    }

    timeSelect.innerHTML = "<option value=''>Elegir horario</option>" + slots.map((slot) => `<option value="${slot}">${slot}</option>`).join("");
  }

  async function submitAppointment(event) {
    event.preventDefault();
    const button = document.getElementById("btn-submit");
    const status = document.getElementById("form-status");
    button.disabled = true;
    status.textContent = "Reservando...";
    status.className = "form-status";

    try {
      const fullName = document.getElementById("f-name").value.trim();
      const phone = document.getElementById("f-phone").value.trim();
      const instagram = document.getElementById("f-ig").value.trim();
      const email = document.getElementById("f-email").value.trim();
      const professionalId = document.getElementById("f-professional").value;
      const serviceId = document.getElementById("f-service").value;
      const date = document.getElementById("f-date").value;
      const time = document.getElementById("f-time").value;
      const notes = document.getElementById("f-notes").value.trim();

      if (!time) throw new Error("Elegí un horario");

      let clients = await api("clients", `select=*&phone=eq.${encodeURIComponent(phone)}`);
      let clientId;

      if (clients.length) {
        clientId = clients[0].id;
        const patch = {
          full_name: fullName,
          instagram: instagram || null,
          email: email || null,
        };
        await api("clients", `id=eq.${clientId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
      } else {
        const createdClient = await api("clients", "", {
          method: "POST",
          body: JSON.stringify({ full_name: fullName, phone, instagram: instagram || null, email: email || null }),
        });
        clientId = createdClient?.[0]?.id;
      }

      const priceRow = prices.find((row) => row.service_id === serviceId && row.professional_id === professionalId);
      const price = priceRow ? priceRow.price_ars : 0;
      const service = services.find((row) => row.id === serviceId);
      const duration = service ? service.duration_minutes : 60;
      const endTime = minutesToTime(timeToMinutes(time) + duration);

      const createdAppointment = await api("appointments", "", {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          professional_id: professionalId,
          service_id: serviceId,
          appointment_date: date,
          start_time: time,
          end_time: endTime,
          price_ars: price,
          status: "confirmed",
          client_notes: notes || null,
          confirmed_at: new Date().toISOString(),
        }),
      });

      let message = "Turno reservado exitosamente.";
      if (createdAppointment?.[0]?.id && email) {
        try {
          await invokeAppointmentEmail(createdAppointment[0].id);
          message = `Turno reservado y confirmación enviada a ${email}.`;
        } catch {
          message = "Turno reservado. El email de confirmación quedó pendiente.";
        }
      }

      status.textContent = message;
      status.className = "form-status success";
      document.getElementById("appointment-form").reset();
      document.getElementById("f-time").innerHTML = "<option value=''>Elegir fecha primero</option>";
      if (document.getElementById("view-dashboard").classList.contains("active")) loadDashboard();
      if (document.getElementById("view-clients").classList.contains("active")) loadClients();
    } catch (error) {
      status.textContent = `✕ ${error.message || "Error al reservar"}`;
      status.className = "form-status error";
    } finally {
      button.disabled = false;
    }
  }

  async function loadClients() {
    try {
      const clientsPromise = api("clients", "select=*&order=created_at.desc");
      const loyaltyPromise = api("v_client_loyalty_summary", "select=*").catch(() => []);
      const [clients, loyalty] = await Promise.all([clientsPromise, loyaltyPromise]);

      clientsCache = clients;
      loyaltyMap = new Map((loyalty || []).map((row) => [row.client_id, row]));
      renderClients(clientsCache);
    } catch (error) {
      document.getElementById("clients-list").innerHTML = `<p class="empty-msg">${error.message}</p>`;
    }
  }

  function renderClients(clients) {
    const container = document.getElementById("clients-list");
    if (!clients.length) {
      container.innerHTML = "<p class='empty-msg'>No hay clientas registradas</p>";
      return;
    }

    container.innerHTML = clients.map((client) => {
      const loyalty = loyaltyMap.get(client.id);
      const points = loyalty?.points_balance || 0;
      return `
        <div class="client-card">
          <h4>${escapeHtml(client.full_name)}</h4>
          <p>${escapeHtml(client.phone)}${client.instagram ? ` · ${escapeHtml(client.instagram)}` : ""}${client.email ? `<br>${escapeHtml(client.email)}` : ""}</p>
          <div class="client-badges">
            <span class="visits-badge">${client.total_visits} visita${client.total_visits !== 1 ? "s" : ""}</span>
            <span class="points-badge">${points} pts</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function bindClientSearch() {
    document.getElementById("client-search").addEventListener("input", (event) => {
      const query = event.target.value.toLowerCase();
      const filtered = clientsCache.filter((client) => client.full_name.toLowerCase().includes(query) || client.phone.includes(query));
      renderClients(filtered);
    });
  }

  async function loadReviewsModeration() {
    const container = document.getElementById("reviews-list");
    container.innerHTML = "<div class='review-card skeleton' style='height:180px'></div><div class='review-card skeleton' style='height:180px'></div>";

    try {
      const reviews = await api("reviews", "select=id,appointment_id,rating,comment,author_label,is_approved,is_published,published_at,created_at,appointments(appointment_date,start_time,service_id,professional_id)&order=created_at.desc");
      renderReviews(reviews || []);
    } catch (error) {
      container.innerHTML = `<p class="empty-msg">${error.message}</p>`;
    }
  }

  function renderReviews(reviews) {
    const container = document.getElementById("reviews-list");
    if (!reviews.length) {
      container.innerHTML = "<p class='empty-msg'>No hay reseñas pendientes todavía.</p>";
      return;
    }

    container.innerHTML = reviews.map((review) => {
      const appointment = review.appointments || {};
      const service = services.find((item) => item.id === appointment.service_id);
      const professional = professionals.find((item) => item.id === appointment.professional_id);
      const badges = [
        review.is_published ? "<span class='review-badge published'>Publicada</span>" : "",
        review.is_approved && !review.is_published ? "<span class='review-badge approved'>Aprobada</span>" : "",
        !review.is_approved ? "<span class='review-badge pending'>Pendiente</span>" : "",
      ].join("");

      return `
        <article class="review-card">
          <div class="review-stars">${"★".repeat(Number(review.rating) || 5)}</div>
          <h4>${escapeHtml(review.author_label)}</h4>
          <p>${escapeHtml(service?.name || "Servicio")} · ${escapeHtml(professional?.name || "Profesional")} · ${appointment.appointment_date ? escapeHtml(formatDate(appointment.appointment_date)) : ""} ${appointment.start_time ? `· ${escapeHtml(formatTime(appointment.start_time))} hs` : ""}</p>
          <p style="margin-top:12px;color:var(--text-soft);">${escapeHtml(review.comment)}</p>
          <div class="review-badges">${badges}</div>
          <div class="review-actions">
            ${!review.is_approved ? `<button class="action-btn" onclick="vasca.approveReview('${review.id}')">Aprobar</button>` : ""}
            ${review.is_approved && !review.is_published ? `<button class="action-btn" onclick="vasca.publishReview('${review.id}')">Publicar</button>` : ""}
            ${review.is_published ? `<button class="action-btn danger" onclick="vasca.unpublishReview('${review.id}')">Ocultar</button>` : ""}
          </div>
        </article>
      `;
    }).join("");
  }

  async function updateReview(reviewId, patch) {
    await api("reviews", `id=eq.${reviewId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    loadReviewsModeration();
  }

  function sendWhatsApp(phone, message, label) {
    const clean = phone.replace(/\D/g, "");
    const number = clean.startsWith("54") ? clean : `54${clean}`;
    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    const toast = document.getElementById("wa-toast");
    document.getElementById("wa-toast-text").textContent = label || "Notificar a la clienta";
    document.getElementById("wa-toast-link").href = url;
    toast.style.display = "flex";
    clearTimeout(window._waToastTimer);
    window._waToastTimer = setTimeout(() => { toast.style.display = "none"; }, 15000);
  }

  function fmtDateNice(date) {
    return new Date(`${date}T12:00:00`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  function openEditModal(id, professionalId, serviceId, date, time, phone, clientName, serviceName) {
    editingAppt = { id, professionalId, serviceId, phone, clientName, serviceName };
    document.getElementById("edit-modal").style.display = "flex";
    document.getElementById("edit-status").textContent = "";

    const service = services.find((item) => item.id === serviceId);
    const professional = professionals.find((item) => item.id === professionalId);
    document.getElementById("edit-info").textContent = `${service?.name || serviceName} con ${professional?.name || ""} — ${clientName}`;
    document.getElementById("edit-date").value = date;
    document.getElementById("edit-time").value = formatTime(time);
  }

  async function saveEdit() {
    const button = document.getElementById("btn-edit-save");
    const status = document.getElementById("edit-status");
    const newDate = document.getElementById("edit-date").value;
    const newTime = document.getElementById("edit-time").value;

    if (!newDate || !newTime) {
      status.textContent = "Completá fecha y hora";
      status.className = "form-status error";
      return;
    }

    button.disabled = true;
    const service = services.find((item) => item.id === editingAppt.serviceId);
    const duration = service ? service.duration_minutes : 60;
    const endTime = minutesToTime(timeToMinutes(newTime) + duration);

    try {
      await api("appointments", `id=eq.${editingAppt.id}`, {
        method: "PATCH",
        body: JSON.stringify({ appointment_date: newDate, start_time: newTime, end_time: endTime }),
      });

      closeEditModal();
      loadDashboard();
      if (document.getElementById("view-calendar").classList.contains("active")) renderCalendar();

      if (editingAppt.phone) {
        const message = `¡Hola ${editingAppt.clientName}! Te informamos que tu turno de *${editingAppt.serviceName}* fue modificado.\n\nNueva fecha: *${fmtDateNice(newDate)}*\nNuevo horario: *${newTime} hs*\n\nSi tenés alguna consulta escribinos. — Vasca Lashes`;
        sendWhatsApp(editingAppt.phone, message, `Turno modificado — ${editingAppt.clientName}`);
      }
    } catch (error) {
      status.textContent = `Error: ${error.message}`;
      status.className = "form-status error";
    } finally {
      button.disabled = false;
    }
  }

  function closeEditModal() {
    document.getElementById("edit-modal").style.display = "none";
    editingAppt = null;
  }

  async function cancelAppt(id, phone, clientName, serviceName, date, time) {
    if (!confirm("¿Cancelar este turno?")) return;

    try {
      await updateStatus(id, "cancelled");
      if (phone) {
        const message = `Hola ${clientName}. Lamentamos informarte que tu turno de *${serviceName}* del *${fmtDateNice(date)}* a las *${formatTime(time)} hs* fue cancelado.\n\nPodés reservar un nuevo turno en nuestra web cuando quieras.\n\n— Vasca Lashes`;
        sendWhatsApp(phone, message, `Turno cancelado — ${clientName}`);
      }
    } catch (error) {
      alert(`Error al cancelar: ${error.message}`);
    }
  }

  function sendReminder(appointmentId, phone, clientName, serviceName, date, time) {
    if (!phone) {
      alert("Esta clienta no tiene teléfono registrado");
      return;
    }

    const message = `¡Hola ${clientName}! Te recordamos que mañana tenés turno de *${serviceName}*.\n\nHorario: *${formatTime(time)} hs*\nDirección: *Alvarado 968*\n\nSi necesitás reprogramar, avisanos con tiempo. — Vasca Lashes`;
    sendWhatsApp(phone, message, `Recordatorio — ${clientName}`);

    const sent = JSON.parse(localStorage.getItem("vasca_reminders_sent") || "{}");
    sent[appointmentId] = new Date().toISOString();
    localStorage.setItem("vasca_reminders_sent", JSON.stringify(sent));
    renderReminders();
  }

  function sendAllReminders() {
    const sent = JSON.parse(localStorage.getItem("vasca_reminders_sent") || "{}");
    const pending = tomorrowAppts.filter((appointment) => !sent[appointment.id] && appointment.clients?.phone);

    if (!pending.length) {
      alert("Ya se enviaron todos los recordatorios");
      return;
    }

    if (!confirm(`¿Enviar recordatorio a ${pending.length} clienta(s)?`)) return;

    pending.forEach((appointment, index) => {
      setTimeout(() => {
        sendReminder(
          appointment.id,
          appointment.clients.phone,
          appointment.clients.full_name || "Clienta",
          appointment.services?.name || "",
          appointment.appointment_date,
          appointment.start_time
        );
      }, index * 1500);
    });
  }

  // --- SECCIÓN AJUSTES & HORARIOS ---
  async function loadSettingsView() {
    const profSelect = document.getElementById("settings-professional");
    if (!profSelect) return;
    const professionalId = profSelect.value;
    if (!professionalId) return;

    const tbody = document.getElementById("schedule-tbody");
    tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">Cargando horarios...</td></tr>`;

    try {
      const schedule = await api("weekly_schedule", `select=*&professional_id=eq.${professionalId}`);
      currentWeeklySchedule = schedule;

      const daysOfWeek = [
        { num: 1, name: "Lunes" },
        { num: 2, name: "Martes" },
        { num: 3, name: "Miércoles" },
        { num: 4, name: "Jueves" },
        { num: 5, name: "Viernes" },
        { num: 6, name: "Sábado" },
        { num: 0, name: "Domingo" }
      ];

      tbody.innerHTML = daysOfWeek.map(day => {
        const row = schedule.find(r => r.day_of_week === day.num);
        const active = row ? row.is_active : false;
        const startTime = row ? formatTime(row.start_time) : "09:00";
        const endTime = row ? formatTime(row.end_time) : "18:00";
        const breakStart = (row && row.break_start) ? formatTime(row.break_start) : "13:00";
        const breakEnd = (row && row.break_end) ? formatTime(row.break_end) : "14:00";

        return `
          <tr data-day="${day.num}">
            <td style="font-weight:600;">${day.name}</td>
            <td>
              <label class="switch-container">
                <input type="checkbox" class="schedule-check" ${active ? "checked" : ""} onchange="vasca.toggleRowActive(this)">
                <span class="switch-slider"></span>
              </label>
            </td>
            <td><input type="time" class="schedule-start" value="${startTime}" ${!active ? "disabled" : ""}></td>
            <td><input type="time" class="schedule-end" value="${endTime}" ${!active ? "disabled" : ""}></td>
            <td><input type="time" class="schedule-break-start" value="${breakStart}" ${!active ? "disabled" : ""}></td>
            <td><input type="time" class="schedule-break-end" value="${breakEnd}" ${!active ? "disabled" : ""}></td>
          </tr>
        `;
      }).join("");
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-msg" style="color:var(--red);">Error: ${error.message}</td></tr>`;
    }

    generateInstagramStory();
  }

  function toggleRowActive(checkbox) {
    const row = checkbox.closest("tr");
    const inputs = row.querySelectorAll("input[type='time']");
    inputs.forEach(input => {
      input.disabled = !checkbox.checked;
    });
  }

  async function saveSchedules(event) {
    event.preventDefault();
    const profSelect = document.getElementById("settings-professional");
    const professionalId = profSelect.value;
    const status = document.getElementById("schedule-status");
    const button = document.querySelector("#schedule-form button[type='submit']");

    if (!professionalId) return;

    button.disabled = true;
    status.textContent = "Guardando...";
    status.className = "form-status";

    try {
      const rows = document.querySelectorAll("#schedule-tbody tr");
      const promises = [];

      for (const row of rows) {
        const dayOfWeek = parseInt(row.dataset.day, 10);
        const isActive = row.querySelector(".schedule-check").checked;
        const startTime = row.querySelector(".schedule-start").value;
        const endTime = row.querySelector(".schedule-end").value;
        const breakStart = row.querySelector(".schedule-break-start").value || null;
        const breakEnd = row.querySelector(".schedule-break-end").value || null;

        const existing = currentWeeklySchedule.find(r => r.day_of_week === dayOfWeek);

        if (existing) {
          promises.push(
            api("weekly_schedule", `id=eq.${existing.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                is_active: isActive,
                start_time: startTime + ":00",
                end_time: endTime + ":00",
                break_start: breakStart ? breakStart + ":00" : null,
                break_end: breakEnd ? breakEnd + ":00" : null
              })
            })
          );
        } else {
          promises.push(
            api("weekly_schedule", "", {
              method: "POST",
              body: JSON.stringify({
                professional_id: professionalId,
                day_of_week: dayOfWeek,
                is_active: isActive,
                start_time: startTime + ":00",
                end_time: endTime + ":00",
                break_start: breakStart ? breakStart + ":00" : null,
                break_end: breakEnd ? breakEnd + ":00" : null
              })
            })
          );
        }
      }

      await Promise.all(promises);
      status.textContent = "¡Horarios guardados exitosamente!";
      status.className = "form-status success";
      loadSettingsView();
    } catch (error) {
      status.textContent = `✕ Error al guardar: ${error.message}`;
      status.className = "form-status error";
    } finally {
      button.disabled = false;
    }
  }

  // --- SECCIÓN INSTAGRAM STORIES GENERATOR ---
  async function getDaySlotsData(dateValue, professionalId) {
    if (!dateValue || !professionalId) return { slots: [], booked: [], isBlocked: false, noSchedule: false };

    const dayOfWeek = new Date(`${dateValue}T12:00:00`).getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
    const [schedule, existing, blocked] = await Promise.all([
      api("weekly_schedule", `select=*&professional_id=eq.${professionalId}&day_of_week=eq.${dayOfWeek}&is_active=eq.true`),
      api("appointments", `select=start_time,end_time&professional_id=eq.${professionalId}&appointment_date=eq.${dateValue}&status=neq.cancelled`),
      api("blocked_dates", `select=id&blocked_date=eq.${dateValue}&or=(professional_id.eq.${professionalId},professional_id.is.null)`),
    ]);

    if (blocked.length) {
      return { slots: [], booked: [], isBlocked: true, noSchedule: false };
    }

    if (!schedule.length) {
      return { slots: [], booked: [], isBlocked: false, noSchedule: true };
    }

    const sched = schedule[0];
    const duration = 60; // 60 minutes for general interval slot
    const slots = [];
    let current = timeToMinutes(sched.start_time);
    const end = timeToMinutes(sched.end_time);
    const breakStart = sched.break_start ? timeToMinutes(sched.break_start) : null;
    const breakEnd = sched.break_end ? timeToMinutes(sched.break_end) : null;

    while (current + duration <= end) {
      const slotStart = current;
      const slotEnd = current + duration;

      if (breakStart !== null && breakEnd !== null && slotStart < breakEnd && slotEnd > breakStart) {
        current = breakEnd;
        continue;
      }

      const timeStr = minutesToTime(slotStart);
      const isBooked = existing.some(appt => {
        const apptStart = timeToMinutes(appt.start_time);
        const apptEnd = timeToMinutes(appt.end_time);
        return slotStart < apptEnd && slotEnd > apptStart;
      });

      slots.push({
        time: timeStr,
        isBooked
      });

      current += duration;
    }

    return { slots, isBlocked: false, noSchedule: false };
  }

  async function generateInstagramStory() {
    const canvas = document.getElementById("instagram-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const dateVal = document.getElementById("insta-date").value;
    const professionalId = document.getElementById("insta-professional").value;
    const bgBlur = parseInt(document.getElementById("insta-bg-blur").value, 10);
    const bgDarken = parseInt(document.getElementById("insta-bg-darken").value, 10);
    const bgPreset = document.getElementById("insta-bg-preset").value;

    const professional = professionals.find(p => p.id === professionalId);
    const profName = professional ? professional.name : "";

    ctx.clearRect(0, 0, 1080, 1920);

    // 1. Draw Background
    if (uploadedBgImage) {
      drawBackgroundWithImage(ctx, uploadedBgImage, bgBlur, bgDarken);
    } else {
      drawBackgroundPreset(ctx, bgPreset, bgBlur, bgDarken);
    }

    // 2. Draw Central Card (Glassmorphic)
    const cardX = 100;
    const cardY = 200;
    const cardW = 880;
    const cardH = 1520;
    const radius = 40;

    ctx.save();
    ctx.fillStyle = "rgba(26, 24, 22, 0.85)";
    ctx.strokeStyle = "rgba(255, 245, 235, 0.12)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(cardX + radius, cardY);
    ctx.lineTo(cardX + cardW - radius, cardY);
    ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + radius);
    ctx.lineTo(cardX + cardW, cardY + cardH - radius);
    ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - radius, cardY + cardH);
    ctx.lineTo(cardX + radius, cardY + cardH);
    ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - radius);
    ctx.lineTo(cardX, cardY + radius);
    ctx.quadraticCurveTo(cardX, cardY, cardX + radius, cardY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 3. Draw Header Texts
    ctx.fillStyle = "#c9a88e";
    ctx.font = "bold 80px 'Cormorant Garamond', Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("VASCA", 540, 340);

    ctx.fillStyle = "#8a7a6c";
    ctx.font = "bold 24px 'Manrope', Arial, sans-serif";
    ctx.letterSpacing = "6px";
    ctx.fillText("LASHES & EYEBROWS", 540, 390);
    ctx.letterSpacing = "0px";

    ctx.strokeStyle = "rgba(255, 245, 235, 0.08)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(250, 440);
    ctx.lineTo(830, 440);
    ctx.stroke();

    ctx.fillStyle = "#c4b5a5";
    ctx.font = "bold 32px 'Manrope', Arial, sans-serif";
    ctx.fillText("TURNOS DISPONIBLES", 540, 500);

    let dateText = "";
    if (dateVal) {
      dateText = new Date(`${dateVal}T12:00:00`).toLocaleDateString("es-AR", {
        weekday: "long",
        day: "numeric",
        month: "long"
      });
      dateText = dateText.charAt(0).toUpperCase() + dateText.slice(1);
    } else {
      dateText = "Elegí una fecha";
    }
    ctx.fillStyle = "#f5efe8";
    ctx.font = "italic 44px 'Cormorant Garamond', Georgia, serif";
    ctx.fillText(dateText, 540, 560);

    if (profName) {
      ctx.fillStyle = "#8a7a6c";
      ctx.font = "500 28px 'Manrope', Arial, sans-serif";
      ctx.fillText(`Con ${profName}`, 540, 610);
    }

    // 4. Draw Slots
    try {
      const { slots, isBlocked, noSchedule } = await getDaySlotsData(dateVal, professionalId);

      if (isBlocked) {
        ctx.fillStyle = "#ff6b6b";
        ctx.font = "italic 36px 'Cormorant Garamond', Georgia, serif";
        ctx.fillText("Día bloqueado o no disponible", 540, 900);
        return;
      }

      if (noSchedule) {
        ctx.fillStyle = "#8a7a6c";
        ctx.font = "italic 36px 'Cormorant Garamond', Georgia, serif";
        ctx.fillText("Sin horarios de trabajo asignados", 540, 900);
        return;
      }

      if (!slots || !slots.length) {
        ctx.fillStyle = "#8a7a6c";
        ctx.font = "italic 36px 'Cormorant Garamond', Georgia, serif";
        ctx.fillText("No hay horarios configurados para este día", 540, 900);
        return;
      }

      const startY = 680;
      const slotH = 100;
      const slotW = 320;
      const col1X = 180;
      const col2X = 580;
      const gapY = 30;

      slots.forEach((slot, index) => {
        const isCol2 = index % 2 === 1;
        const rowIndex = Math.floor(index / 2);
        const x = isCol2 ? col2X : col1X;
        const y = startY + rowIndex * (slotH + gapY);

        if (y + slotH > cardY + cardH - 100) return;

        drawSlotPill(ctx, x, y, slotW, slotH, slot.time, slot.isBooked);
      });

      ctx.fillStyle = "rgba(245, 239, 232, 0.4)";
      ctx.font = "italic 24px 'Cormorant Garamond', Georgia, serif";
      ctx.fillText("Reservá tu turno en vascalashes.com", 540, 1660);

    } catch (err) {
      console.error(err);
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "28px Arial";
      ctx.fillText("Error al cargar turnos del día", 540, 900);
    }
  }

  function drawBackgroundPreset(ctx, preset, blur, darken) {
    let gradient = ctx.createLinearGradient(0, 0, 0, 1920);
    if (preset === "luxury-dark") {
      gradient.addColorStop(0, "#0f0e0d");
      gradient.addColorStop(1, "#1c1a18");
    } else if (preset === "warm-nude") {
      gradient.addColorStop(0, "#e3d5ca");
      gradient.addColorStop(1, "#d5bdaf");
    } else if (preset === "rose-gold") {
      gradient.addColorStop(0, "#ebd3d4");
      gradient.addColorStop(1, "#c9a88e");
    } else if (preset === "soft-brown") {
      gradient.addColorStop(0, "#8f7769");
      gradient.addColorStop(1, "#3c332e");
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1920);

    if (darken > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${darken / 100})`;
      ctx.fillRect(0, 0, 1080, 1920);
    }
  }

  function drawBackgroundWithImage(ctx, img, blur, darken) {
    ctx.save();
    if (blur > 0) {
      ctx.filter = `blur(${blur}px) brightness(${1 - darken / 100})`;
    } else {
      ctx.filter = `brightness(${1 - darken / 100})`;
    }

    const scale = Math.max(1080 / img.width, 1920 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (1080 - w) / 2;
    const y = (1920 - h) / 2;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  function drawSlotPill(ctx, x, y, w, h, time, isBooked) {
    const radius = 24;
    ctx.save();

    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + h/2);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h/2);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    if (isBooked) {
      ctx.fillStyle = "rgba(15, 14, 13, 0.4)";
      ctx.strokeStyle = "rgba(255, 245, 235, 0.04)";
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(245, 239, 232, 0.25)";
      ctx.font = "bold 38px 'Manrope', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(time + " hs", x + w/2, y + h/2);

      ctx.strokeStyle = "rgba(255, 107, 107, 0.6)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + 40, y + h/2);
      ctx.lineTo(x + w - 40, y + h/2);
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(201, 168, 142, 0.15)";
      ctx.strokeStyle = "#c9a88e";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#f5efe8";
      ctx.font = "bold 38px 'Manrope', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(time + " hs", x + w/2, y + h/2);
    }
    ctx.restore();
  }

  function setupInstagramListeners() {
    const fileInput = document.getElementById("insta-bg-file");
    const presetSelect = document.getElementById("insta-bg-preset");
    const blurSlider = document.getElementById("insta-bg-blur");
    const darkenSlider = document.getElementById("insta-bg-darken");
    const dateInput = document.getElementById("insta-date");
    const profSelect = document.getElementById("insta-professional");

    const redraw = () => generateInstagramStory();

    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) {
          uploadedBgImage = null;
          redraw();
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            uploadedBgImage = img;
            redraw();
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    [presetSelect, blurSlider, darkenSlider, dateInput, profSelect].forEach(el => {
      if (el) el.addEventListener("change", redraw);
    });

    if (blurSlider) blurSlider.addEventListener("input", redraw);
    if (darkenSlider) darkenSlider.addEventListener("input", redraw);

    const btnDownload = document.getElementById("btn-insta-download");
    if (btnDownload) {
      btnDownload.addEventListener("click", () => {
        const canvas = document.getElementById("instagram-canvas");
        if (!canvas) return;
        const dateVal = document.getElementById("insta-date").value || today();
        const link = document.createElement("a");
        link.download = `cronograma-vasca-${dateVal}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      });
    }

    const btnCopy = document.getElementById("btn-insta-copy");
    if (btnCopy) {
      btnCopy.addEventListener("click", () => {
        const canvas = document.getElementById("instagram-canvas");
        if (!canvas) return;
        canvas.toBlob(async (blob) => {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({
                [blob.type]: blob
              })
            ]);
            alert("¡Imagen copiada al portapapeles! Ya podés pegarla en Instagram o WhatsApp.");
          } catch (err) {
            console.error("Error al copiar imagen:", err);
            alert("No se pudo copiar automáticamente. Podés descargar la imagen con el botón 'Descargar'.");
          }
        });
      });
    }
  }

  function populateSettingsSelects() {
    const profSelect = document.getElementById("settings-professional");
    const instaProfSelect = document.getElementById("insta-professional");
    if (profSelect) {
      profSelect.innerHTML = professionals.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    }
    if (instaProfSelect) {
      instaProfSelect.innerHTML = professionals.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const instaDateInput = document.getElementById("insta-date");
    if (instaDateInput) {
      instaDateInput.value = tomorrow.toISOString().split("T")[0];
    }
  }

  async function init() {
    setupNav();
    setupMobileMenu();
    bindClientSearch();
    setHeaderDate();

    [professionals, services, prices] = await Promise.all([
      api("professionals", "select=*&is_active=eq.true&order=sort_order"),
      api("services", "select=*&is_active=eq.true&order=sort_order"),
      api("service_professional_prices", "select=*,services(name),professionals(name)&is_active=eq.true"),
    ]);

    populateFormSelects();
    setupFormListeners();
    populateSettingsSelects();
    setupInstagramListeners();
    
    document.getElementById("schedule-form").addEventListener("submit", saveSchedules);
    document.getElementById("settings-professional").addEventListener("change", loadSettingsView);
    
    loadDashboard();
  }

  window.logoutAdmin = function () {
    localStorage.removeItem("vasca_token");
    localStorage.removeItem("vasca_refresh");
    localStorage.removeItem("vasca_user");
    localStorage.removeItem("vasca_role");
    window.location.href = "login.html";
  };

  window.vasca = {
    editAppt: openEditModal,
    completeAppt: (id) => updateStatus(id, "completed"),
    cancelAppt,
    saveEdit,
    closeModal: closeEditModal,
    sendReminder,
    sendAllReminders,
    approveReview: (id) => updateReview(id, { is_approved: true }),
    publishReview: (id) => updateReview(id, { is_approved: true, is_published: true }),
    unpublishReview: (id) => updateReview(id, { is_published: false }),
    toggleRowActive,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
