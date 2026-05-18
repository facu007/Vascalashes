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
    const dayOfWeek = (new Date(`${dateValue}T12:00:00`).getDay() + 6) % 7;

    const [schedule, existing, blocked] = await Promise.all([
      api("weekly_schedule", `select=*&professional_id=eq.${professionalId}&day_of_week=eq.${dayOfWeek + 1}&is_active=eq.true`),
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
  };

  document.addEventListener("DOMContentLoaded", init);
})();
