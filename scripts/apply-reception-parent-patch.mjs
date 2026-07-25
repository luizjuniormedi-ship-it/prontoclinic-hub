import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Patch target not found: ${label}`);
  }
  return source.replace(before, after);
}

const pagePath = "src/pages/ReceptionPage.tsx";
let page = fs.readFileSync(pagePath, "utf8");
page = replaceOnce(
  page,
  `  const closeCheckin = () => {\n    if (checkingIn) return;\n    setCheckinTarget(null);\n    setReadiness(null);\n    setExceptionReason("");\n  };\n\n  const confirmCheckin = async () => {`,
  `  const closeCheckin = () => {\n    if (checkingIn) return;\n    setCheckinTarget(null);\n    setReadiness(null);\n    setExceptionReason("");\n  };\n\n  const refreshCheckinReadiness = useCallback(async () => {\n    if (!checkinTarget) return;\n    const nextReadiness = await receptionService.getReadiness(checkinTarget.id);\n    setReadiness(nextReadiness);\n  }, [checkinTarget]);\n\n  const confirmCheckin = async () => {`,
  "refresh callback",
);
page = replaceOnce(
  page,
  `        onResolveIssue={resolveIssueFromCheckin}\n      />`,
  `        onResolveIssue={resolveIssueFromCheckin}\n        onCheckoutChanged={refreshCheckinReadiness}\n      />`,
  "dialog callback prop",
);
fs.writeFileSync(pagePath, page);

const panelPath = "src/components/reception/ReceptionFinancialPanel.tsx";
let panel = fs.readFileSync(panelPath, "utf8");
panel = replaceOnce(
  panel,
  `  const run = async (action: string, operation: () => Promise<unknown>, success: string) => {\n    try {\n      setBusyAction(action);\n      await operation();\n      toast({ title: success });\n      await onChanged();\n    } catch (error) {\n      toast({\n        title: "Não foi possível concluir a ação",\n        description: (error as Error).message,\n        variant: "destructive",\n      });\n    } finally {\n      setBusyAction(null);\n    }\n  };`,
  `  const run = async (\n    action: string,\n    operation: () => Promise<unknown>,\n    success: string,\n  ): Promise<boolean> => {\n    try {\n      setBusyAction(action);\n      await operation();\n      toast({ title: success });\n      await onChanged();\n      return true;\n    } catch (error) {\n      toast({\n        title: "Não foi possível concluir a ação",\n        description: (error as Error).message,\n        variant: "destructive",\n      });\n      return false;\n    } finally {\n      setBusyAction(null);\n    }\n  };`,
  "run return value",
);
panel = replaceOnce(
  panel,
  `    try {\n      await run("payment", () => receptionCheckoutService.registerPayment({\n        appointmentId,\n        amount: paymentValue,\n        paymentMethod,\n        idempotencyKey: attemptKey,\n        externalReference: paymentReference,\n        installmentCount: Number(installmentCount) || 1,\n        notes: paymentNotes,\n      }), "Pagamento registrado e título atualizado");\n      setPaymentAttemptKey("");\n      setPaymentReference("");\n      setPaymentNotes("");\n    } catch {\n      // run already reports the error; keep the same idempotency key for a safe retry.\n    }`,
  `    const succeeded = await run("payment", () => receptionCheckoutService.registerPayment({\n      appointmentId,\n      amount: paymentValue,\n      paymentMethod,\n      idempotencyKey: attemptKey,\n      externalReference: paymentReference,\n      installmentCount: Number(installmentCount) || 1,\n      notes: paymentNotes,\n    }), "Pagamento registrado e título atualizado");\n\n    if (succeeded) {\n      setPaymentAttemptKey("");\n      setPaymentReference("");\n      setPaymentNotes("");\n    }`,
  "payment retry idempotency",
);
fs.writeFileSync(panelPath, panel);
