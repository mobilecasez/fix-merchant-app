import type { LoaderFunction, ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Button,
  Modal,
  TextField,
  FormLayout,
  Toast,
  Frame,
  Banner,
  Badge,
  InlineStack,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader: LoaderFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Check if user is account owner
  const sessionData = await prisma.session.findUnique({
    where: { id: session.id },
    select: { accountOwner: true },
  });

  if (!sessionData?.accountOwner) {
    return json({ error: "Access denied. Admin only." }, { status: 403 });
  }

  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: { price: 'asc' },
  });

  return json({ plans });
};

export const action: ActionFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Check if user is account owner
  const sessionData = await prisma.session.findUnique({
    where: { id: session.id },
    select: { accountOwner: true },
  });

  if (!sessionData?.accountOwner) {
    return json({ error: "Access denied" }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get("action");

  try {
    if (action === "create" || action === "update") {
      const id = formData.get("id") as string;
      const name = formData.get("name") as string;
      const price = parseFloat(formData.get("price") as string);
      const productLimit = parseInt(formData.get("productLimit") as string);
      const description = formData.get("description") as string;
      const isActive = formData.get("isActive") === "true";

      if (action === "create") {
        await prisma.subscriptionPlan.create({
          data: { name, price, productLimit, description, isActive },
        });
        return json({ success: true, message: "Plan created successfully" });
      } else {
        await prisma.subscriptionPlan.update({
          where: { id },
          data: { name, price, productLimit, description, isActive },
        });
        return json({ success: true, message: "Plan updated successfully" });
      }
    } else if (action === "delete") {
      const id = formData.get("id") as string;
      
      // Check if any shops are using this plan
      const subscriptionsCount = await prisma.shopSubscription.count({
        where: { planId: id },
      });

      if (subscriptionsCount > 0) {
        return json({ 
          error: `Cannot delete plan. ${subscriptionsCount} shop(s) are currently subscribed to this plan.` 
        }, { status: 400 });
      }

      await prisma.subscriptionPlan.delete({
        where: { id },
      });
      return json({ success: true, message: "Plan deleted successfully" });
    } else if (action === "toggle") {
      const id = formData.get("id") as string;
      const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
      
      await prisma.subscriptionPlan.update({
        where: { id },
        data: { isActive: !plan?.isActive },
      });
      return json({ success: true, message: "Plan status updated" });
    }

    return json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: "An error occurred" }, { status: 500 });
  }
};

export default function SubscriptionPlans() {
  const data = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  
  const [modalActive, setModalActive] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    productLimit: "",
    description: "",
    isActive: true,
  });
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  const isLoading = navigation.state === "submitting";

  if (data.error) {
    return (
      <Page title="Access Denied">
        <Banner tone="critical">
          <p>{data.error}</p>
        </Banner>
      </Page>
    );
  }

  const handleModalClose = useCallback(() => {
    setModalActive(false);
    setEditingPlan(null);
    setFormData({
      name: "",
      price: "",
      productLimit: "",
      description: "",
      isActive: true,
    });
  }, []);

  const handleModalOpen = useCallback((plan?: any) => {
    if (plan) {
      setEditingPlan(plan);
      setFormData({
        name: plan.name,
        price: plan.price.toString(),
        productLimit: plan.productLimit.toString(),
        description: plan.description || "",
        isActive: plan.isActive,
      });
    }
    setModalActive(true);
  }, []);

  const handleSubmit = useCallback(() => {
    const formPayload = new FormData();
    formPayload.append("action", editingPlan ? "update" : "create");
    
    if (editingPlan) {
      formPayload.append("id", editingPlan.id);
    }
    
    formPayload.append("name", formData.name);
    formPayload.append("price", formData.price);
    formPayload.append("productLimit", formData.productLimit);
    formPayload.append("description", formData.description);
    formPayload.append("isActive", formData.isActive.toString());

    submit(formPayload, { method: "post" });
    handleModalClose();
    
    setToastMessage(editingPlan ? "Plan updated successfully" : "Plan created successfully");
    setToastError(false);
    setToastActive(true);
  }, [formData, editingPlan, submit, handleModalClose]);

  const handleDelete = useCallback((planId: string) => {
    if (confirm("Are you sure you want to delete this plan?")) {
      const formPayload = new FormData();
      formPayload.append("action", "delete");
      formPayload.append("id", planId);
      submit(formPayload, { method: "post" });
      
      setToastMessage("Plan deleted successfully");
      setToastError(false);
      setToastActive(true);
    }
  }, [submit]);

  const handleToggle = useCallback((planId: string) => {
    const formPayload = new FormData();
    formPayload.append("action", "toggle");
    formPayload.append("id", planId);
    submit(formPayload, { method: "post" });
  }, [submit]);

  const rows = data.plans.map((plan: any) => [
    <Text as="span" fontWeight="semibold">{plan.name}</Text>,
    `$${plan.price.toFixed(2)}`,
    `${plan.productLimit} products/month`,
    plan.description || "-",
    <Badge tone={plan.isActive ? "success" : "critical"}>
      {plan.isActive ? "Active" : "Inactive"}
    </Badge>,
    <InlineStack gap="200">
      <Button size="slim" onClick={() => handleModalOpen(plan)}>
        Edit
      </Button>
      <Button size="slim" onClick={() => handleToggle(plan.id)}>
        {plan.isActive ? "Deactivate" : "Activate"}
      </Button>
      <Button size="slim" tone="critical" onClick={() => handleDelete(plan.id)}>
        Delete
      </Button>
    </InlineStack>,
  ]);

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={() => setToastActive(false)}
      error={toastError}
    />
  ) : null;

  return (
    <Frame>
      <Page
        title="Subscription Plans"
        subtitle="Manage subscription plans available to merchants"
        primaryAction={{
          content: "Add Plan",
          onAction: () => handleModalOpen(),
        }}
      >
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Plan Name",
                  "Price",
                  "Product Limit",
                  "Description",
                  "Status",
                  "Actions",
                ]}
                rows={rows}
              />
            </Card>
          </Layout.Section>
        </Layout>

        <Modal
          open={modalActive}
          onClose={handleModalClose}
          title={editingPlan ? "Edit Plan" : "Create New Plan"}
          primaryAction={{
            content: editingPlan ? "Update" : "Create",
            onAction: handleSubmit,
            loading: isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: handleModalClose,
            },
          ]}
        >
          <Modal.Section>
            <FormLayout>
              <TextField
                label="Plan Name"
                value={formData.name}
                onChange={(value) => setFormData({ ...formData, name: value })}
                autoComplete="off"
                placeholder="e.g., Basic, Professional, Premium"
              />
              
              <TextField
                label="Price (USD)"
                type="number"
                value={formData.price}
                onChange={(value) => setFormData({ ...formData, price: value })}
                autoComplete="off"
                prefix="$"
                placeholder="4.99"
                step="0.01"
              />
              
              <TextField
                label="Product Limit (per month)"
                type="number"
                value={formData.productLimit}
                onChange={(value) => setFormData({ ...formData, productLimit: value })}
                autoComplete="off"
                placeholder="20"
              />
              
              <TextField
                label="Description"
                value={formData.description}
                onChange={(value) => setFormData({ ...formData, description: value })}
                autoComplete="off"
                multiline={3}
                placeholder="Describe what this plan offers"
              />
            </FormLayout>
          </Modal.Section>
        </Modal>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
