const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

type RequestOptions = RequestInit;

async function doRequest(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let data: any = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    status: response.status,
    data,
  };
}

async function signupAndVerify(payload: any) {
  const signupStart = await doRequest("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (signupStart.status !== 201) {
    throw new Error("Signup start failed");
  }
  const verificationSessionId = signupStart.data?.data?.verificationSessionId;
  const signupVerify = await doRequest("/auth/signup/verify", {
    method: "POST",
    body: JSON.stringify({
      verificationSessionId,
      code: "123456"
    }),
  });
  if (signupVerify.status !== 201) {
    throw new Error("Signup verify failed");
  }
  return signupVerify.data;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function section(title: string) {
  console.log("\n============================================================");
  console.log(title);
  console.log("============================================================\n");
}

async function run() {
  section("TENANT SMOKE TEST START");

  const ts = Date.now();

  const ownerPayload = {
    username: `owner_${ts}`,
    fullName: "Owner User",
    email: `owner_${ts}@example.com`,
    password: "StrongPassword123!",
    phoneNumber: `+1555${String(ts).slice(-7)}`,
  };

  const memberPayload = {
    username: `member_${ts}`,
    fullName: "Member User",
    email: `member_${ts}@example.com`,
    password: "StrongPassword123!",
    phoneNumber: `+1555${String(ts + 1).slice(-7)}`,
  };

  let ownerAccessToken = "";
  let ownerRefreshToken = "";

  // HEALTH CHECK
  section("1) Health check");

  const health = await doRequest("/health");

  console.log("status", health.status);
  console.log("body", JSON.stringify(health.data));

  if (health.status !== 200) {
    console.error("health check failed");
    process.exit(1);
  }

  // SIGNUP OWNER
  section("2) Signup owner");

  const ownerSignupData = await signupAndVerify(ownerPayload);
  
  ownerAccessToken = ownerSignupData?.data?.tokens?.accessToken || "";
  ownerRefreshToken = ownerSignupData?.data?.tokens?.refreshToken || "";
  const ownerUser = ownerSignupData?.data?.user;

  if (!ownerAccessToken || !ownerUser?.id) {
    console.error("owner auth data missing");
    process.exit(1);
  }

  // SIGNUP MEMBER
  section("3) Signup member");

  const memberSignupData = await signupAndVerify(memberPayload);

  const memberUser = memberSignupData?.data?.user;

  if (!memberUser?.id) {
    console.error("member user missing");
    process.exit(1);
  }

  // CREATE TENANT
  section("4) Create tenant");

  const tenantPayload = {
    name: `SmokeTenant ${ts}`,
    description: "Auto created by smoke test",
  };

  const createTenant = await doRequest("/tenants", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerAccessToken}`,
    },
    body: JSON.stringify(tenantPayload),
  });

  console.log("status", createTenant.status);
  console.log("body", JSON.stringify(createTenant.data));

  if (createTenant.status !== 201) {
    console.error("tenant creation failed");
    process.exit(1);
  }

  const tenant = createTenant.data?.data;

  if (!tenant?.slug) {
    console.error("tenant slug missing");
    process.exit(1);
  }

  const tenantSlug = tenant.slug;

  await delay(20);

  // UPDATE TENANT
  section("5) Update tenant");

  const updateTenant = await doRequest(
    `/tenants/${tenantSlug}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
      body: JSON.stringify({
        name: `${tenantPayload.name} Updated`,
        lastKnownUpdatedAt: tenant.updatedAt,
      }),
    }
  );

  console.log("status", updateTenant.status);
  console.log("body", JSON.stringify(updateTenant.data));

  if (updateTenant.status !== 200) {
    console.error("update tenant failed");
    process.exit(1);
  }

  const updatedTenant = updateTenant.data?.data;

  if (!updatedTenant?.updatedAt) {
    console.error("updated tenant missing updatedAt");
    process.exit(1);
  }

  const staleTenantUpdate = await doRequest(
    `/tenants/${tenantSlug}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
      body: JSON.stringify({
        name: "Stale tenant update",
        lastKnownUpdatedAt: tenant.updatedAt,
      }),
    }
  );

  console.log("status", staleTenantUpdate.status);
  console.log("body", JSON.stringify(staleTenantUpdate.data));

  if (staleTenantUpdate.status !== 409 || staleTenantUpdate.data?.error?.code !== "STALE_REQUEST") {
    console.error("stale tenant update failed");
    process.exit(1);
  }

  // GET TENANT
  section("6) Get tenant by slug");

  const getTenant = await doRequest(
    `/tenants/${tenantSlug}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
    }
  );

  console.log("status", getTenant.status);
  console.log("body", JSON.stringify(getTenant.data));

  if (getTenant.status !== 200) {
    console.error("get tenant failed");
    process.exit(1);
  }

  // LIST TENANTS
  section("7) List tenants");

  const listTenants = await doRequest("/tenants", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${ownerAccessToken}`,
    },
  });

  console.log("status", listTenants.status);
  console.log("body", JSON.stringify(listTenants.data));

  if (listTenants.status !== 200) {
    console.error("list tenants failed");
    process.exit(1);
  }

  // ADD MEMBER
  section("8) Add member");

  const addMember = await doRequest(
    `/tenants/${tenantSlug}/members`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
      body: JSON.stringify({
        userId: memberUser.id,
        role: "viewer",
      }),
    }
  );

  console.log("status", addMember.status);
  console.log("body", JSON.stringify(addMember.data));

  if (![200, 201].includes(addMember.status)) {
    console.error("add member failed");
    process.exit(1);
  }

  const membership = addMember.data?.data;

  if (!membership?.id) {
    console.error("membership id missing");
    process.exit(1);
  }

  const membershipId = membership.id;

  // LIST MEMBERS
  section("8) List members");

  const listMembers = await doRequest(
    `/tenants/${tenantSlug}/members`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
    }
  );

  console.log("status", listMembers.status);
  console.log("body", JSON.stringify(listMembers.data));

  if (listMembers.status !== 200) {
    console.error("list members failed");
    process.exit(1);
  }

  // UPDATE MEMBER ROLE
  section("9) Update member role");

  const updateMember = await doRequest(
    `/tenants/${tenantSlug}/members/${membershipId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
      body: JSON.stringify({
        role: "manager",
        lastKnownUpdatedAt: membership.updatedAt,
      }),
    }
  );

  console.log("status", updateMember.status);
  console.log("body", JSON.stringify(updateMember.data));

  if (updateMember.status !== 200) {
    console.error("update member failed");
    process.exit(1);
  }

  const updatedMembership = updateMember.data?.data;

  if (!updatedMembership?.updatedAt) {
    console.error("updated membership missing updatedAt");
    process.exit(1);
  }

  // REMOVE MEMBER
  section("9) Remove member");

  const removeMember = await doRequest(
    `/tenants/${tenantSlug}/members/${membershipId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
      body: JSON.stringify({
        lastKnownUpdatedAt: updatedMembership.updatedAt,
      }),
    }
  );

  console.log("status", removeMember.status);
  console.log("body", JSON.stringify(removeMember.data));

  if (![200, 204].includes(removeMember.status)) {
    console.error("remove member failed");
    process.exit(1);
  }

  // DELETE TENANT
  section("10) Delete tenant");

  const deleteTenant = await doRequest(
    `/tenants/${tenantSlug}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${ownerAccessToken}`,
      },
      body: JSON.stringify({
        confirmDelete: true,
        lastKnownUpdatedAt: updatedTenant.updatedAt,
      }),
    }
  );

  console.log("status", deleteTenant.status);
  console.log("body", JSON.stringify(deleteTenant.data));

  if (![200, 204].includes(deleteTenant.status)) {
    console.error("delete tenant failed");
    process.exit(1);
  }

  // LOGOUT
  section("11) Logout owner");

  const logout = await doRequest("/auth/logout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerAccessToken}`,
    },
    body: JSON.stringify({
      refreshToken: ownerRefreshToken,
    }),
  });

  console.log("status", logout.status);
  console.log("body", JSON.stringify(logout.data));

  if (logout.status !== 200) {
    console.error("logout failed");
    process.exit(1);
  }

  section("TENANT SMOKE TEST PASSED");
}

run().catch((err) => {
  console.error("\nSMOKE TEST FAILED\n");
  console.error(err);
  process.exit(1);
});

export {};