import { requireUser } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { getUserSettings } from "@/lib/settings";
import { createPerson } from "@/lib/actions/people";
import { PageHeader } from "@/components/ui";
import { PersonForm } from "@/components/person-form";

export default async function NewPersonPage() {
  const user = await requireUser();
  const [defs, settings] = await Promise.all([
    loadRegistry(user.id, "PERSON"),
    getUserSettings(user.id),
  ]);

  return (
    <div>
      <PageHeader
        title="New contact"
        description="Only the details you want — everything is optional."
      />
      <PersonForm
        action={createPerson}
        defs={defs}
        values={{}}
        contactPoints={[
          { kind: "EMAIL", label: "", value: "" },
          { kind: "PHONE", label: "mobile", value: "" },
        ]}
        addToGoogle={settings.defaultAddToGoogle}
        cancelHref="/people"
        submitLabel="Create contact"
      />
    </div>
  );
}
