const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "";
const BOOKING_ADDRESS = Deno.env.get("BOOKING_ADDRESS") ?? "Alvarado 968";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://vasca.vercel.app";

type AuthUser = {
  id: string;
  email?: string;
};

type AppointmentRecord = {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: string;
  confirmation_email_status: string;
  confirmation_email_sent_at: string | null;
  clients: {
    id: string;
    full_name: string | null;
    email: string | null;
    auth_user_id: string | null;
  } | null;
  services: { name: string | null } | null;
  professionals: { name: string | null } | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authUserFromToken(authorization: string): Promise<AuthUser | null> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authorization,
    },
  });

  if (!response.ok) return null;
  return await response.json();
}

async function restRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message ?? data?.error ?? text ?? "Supabase request failed";
    throw new Error(message);
  }

  return data;
}

async function getUserRole(userId: string): Promise<string> {
  const data = await restRequest(`profiles?select=role&id=eq.${userId}&limit=1`, {
    method: "GET",
  });

  return data?.[0]?.role ?? "client";
}

async function getAppointmentDetails(appointmentId: string): Promise<AppointmentRecord | null> {
  const query =
    "select=id,appointment_date,start_time,end_time,status,confirmation_email_status,confirmation_email_sent_at," +
    "clients(id,full_name,email,auth_user_id),services(name),professionals(name)" +
    `&id=eq.${appointmentId}&limit=1`;

  const data = await restRequest(`appointments?${query}`, { method: "GET" });
  return data?.[0] ?? null;
}

async function updateEmailStatus(
  appointmentId: string,
  status: string,
  errorMessage: string | null = null,
  sentAt: string | null = null,
) {
  await restRequest(`appointments?id=eq.${appointmentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      confirmation_email_status: status,
      confirmation_email_error: errorMessage,
      confirmation_email_sent_at: sentAt,
    }),
  });
}

function buildCalendarUrl(appointment: AppointmentRecord) {
  const start = `${appointment.appointment_date.replace(/-/g, "")}T${appointment.start_time.slice(0, 5).replace(":", "")}00`;
  const end = `${appointment.appointment_date.replace(/-/g, "")}T${appointment.end_time.slice(0, 5).replace(":", "")}00`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${appointment.services?.name ?? "Turno"} - Vasca`,
    dates: `${start}/${end}`,
    location: BOOKING_ADDRESS,
    details: `Turno con ${appointment.professionals?.name ?? "Vasca"} · ${APP_BASE_URL}/turnos`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildEmailHtml(appointment: AppointmentRecord) {
  const dateLabel = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${appointment.appointment_date}T12:00:00`));

  const clientName = appointment.clients?.full_name ?? "Clienta Vasca";
  const serviceName = appointment.services?.name ?? "Tu servicio";
  const professionalName = appointment.professionals?.name ?? "nuestro equipo";
  const calendarUrl = buildCalendarUrl(appointment);

  return `
    <div style="font-family: Manrope, Arial, sans-serif; background:#f7f1ea; color:#221914; padding:32px 16px;">
      <div style="max-width:560px; margin:0 auto; background:#fffaf5; border:1px solid rgba(34,25,20,0.08); border-radius:24px; overflow:hidden;">
        <div style="padding:32px; background:linear-gradient(135deg, #221914 0%, #3b2d25 100%); color:#f5efe8; text-align:center;">
          <img src="${APP_BASE_URL.replace(/\/$/, "")}/vasca-avatar.jpg" alt="Vasca" width="72" height="72" style="border-radius:50%; border:2px solid rgba(245,239,232,0.3); margin-bottom:16px;" />
          <div style="font-size:12px; letter-spacing:0.28em; text-transform:uppercase; opacity:0.8;">Vasca Lashes & Eyebrows</div>
          <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-size:42px; margin:12px 0 0;">Tu turno está confirmado</h1>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 18px; font-size:16px; line-height:1.7;">Hola ${clientName}, reservamos tu experiencia en Vasca. Acá tenés todos los datos de tu turno.</p>
          <div style="border:1px solid rgba(34,25,20,0.08); border-radius:18px; padding:20px 22px; background:#ffffff;">
            <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid rgba(34,25,20,0.08);">
              <strong>Servicio</strong>
              <span>${serviceName}</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid rgba(34,25,20,0.08);">
              <strong>Profesional</strong>
              <span>${professionalName}</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid rgba(34,25,20,0.08);">
              <strong>Fecha</strong>
              <span style="text-transform:capitalize;">${dateLabel}</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid rgba(34,25,20,0.08);">
              <strong>Horario</strong>
              <span>${appointment.start_time.slice(0, 5)} hs</span>
            </div>
            <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0 0;">
              <strong>Dirección</strong>
              <span>${BOOKING_ADDRESS}</span>
            </div>
          </div>
          <div style="margin-top:28px; display:flex; flex-wrap:wrap; gap:12px;">
            <a href="${calendarUrl}" style="display:inline-block; padding:14px 22px; border-radius:999px; background:#221914; color:#fff8f1; text-decoration:none; font-weight:700;">Agregar al calendario</a>
            <a href="${APP_BASE_URL.replace(/\/$/, "")}/turnos.html" style="display:inline-block; padding:14px 22px; border-radius:999px; border:1px solid rgba(34,25,20,0.12); color:#221914; text-decoration:none; font-weight:700;">Ver mis turnos</a>
          </div>
          <p style="margin:24px 0 0; font-size:14px; line-height:1.7; color:#66524a;">Si necesitás reprogramar, podés hacerlo desde tu panel o escribiéndonos por WhatsApp.</p>
        </div>
      </div>
    </div>
  `;
}

function buildEmailText(appointment: AppointmentRecord) {
  const dateLabel = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${appointment.appointment_date}T12:00:00`));

  return [
    `Hola ${appointment.clients?.full_name ?? "Clienta Vasca"}, tu turno en Vasca está confirmado.`,
    "",
    `Servicio: ${appointment.services?.name ?? "Turno"}`,
    `Profesional: ${appointment.professionals?.name ?? "Vasca"}`,
    `Fecha: ${dateLabel}`,
    `Horario: ${appointment.start_time.slice(0, 5)} hs`,
    `Dirección: ${BOOKING_ADDRESS}`,
    "",
    `Calendario: ${buildCalendarUrl(appointment)}`,
    `Mis turnos: ${APP_BASE_URL.replace(/\/$/, "")}/turnos.html`,
  ].join("\n");
}

async function sendResendEmail(appointment: AppointmentRecord) {
  const recipient = appointment.clients?.email;

  if (!recipient) {
    await updateEmailStatus(appointment.id, "skipped", "missing_client_email", null);
    return { status: "skipped" as const };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [recipient],
      subject: `Tu turno en Vasca · ${appointment.services?.name ?? "Confirmación"}`,
      html: buildEmailHtml(appointment),
      text: buildEmailText(appointment),
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    const errorMessage = payload?.message ?? payload?.error?.message ?? "resend_failed";
    await updateEmailStatus(appointment.id, "failed", errorMessage, null);
    throw new Error(errorMessage);
  }

  const sentAt = new Date().toISOString();
  await updateEmailStatus(appointment.id, "sent", null, sentAt);
  return { status: "sent" as const, resendId: payload?.id ?? null };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !EMAIL_FROM) {
    return jsonResponse({ error: "Missing required environment configuration" }, 500);
  }

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const authUser = await authUserFromToken(authorization);
    if (!authUser?.id) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    const { appointmentId, type } = await request.json();
    if (!appointmentId || typeof appointmentId !== "string") {
      return jsonResponse({ error: "appointmentId is required" }, 400);
    }

    if (type !== "created") {
      return jsonResponse({ error: "Unsupported email type" }, 400);
    }

    const [role, appointment] = await Promise.all([
      getUserRole(authUser.id),
      getAppointmentDetails(appointmentId),
    ]);

    if (!appointment) {
      return jsonResponse({ error: "Appointment not found" }, 404);
    }

    const isAdmin = role === "admin";
    const isOwner = appointment.clients?.auth_user_id === authUser.id;

    if (!isAdmin && !isOwner) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    if (appointment.confirmation_email_status === "sent" && appointment.confirmation_email_sent_at) {
      return jsonResponse({
        ok: true,
        deduplicated: true,
        status: "sent",
        appointmentId,
      });
    }

    const result = await sendResendEmail(appointment);

    return jsonResponse({
      ok: true,
      deduplicated: false,
      appointmentId,
      ...result,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});
