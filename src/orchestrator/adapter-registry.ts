import { ModelRef } from "./types";
import { OrchestratorCapability, OrchestratorModelAdapter } from "./model-adapter";

export class ModelAdapterNotFoundError extends Error {
  constructor(modelId: string) {
    super(`No orchestrator model adapter is registered for model ${modelId}`);
    this.name = "ModelAdapterNotFoundError";
  }
}

export class ModelAdapterCapabilityError extends Error {
  constructor(modelId: string, capability: OrchestratorCapability) {
    super(`Model adapter ${modelId} does not support capability ${capability}`);
    this.name = "ModelAdapterCapabilityError";
  }
}

export class ModelAdapterRegistry {
  private readonly adapters = new Map<string, OrchestratorModelAdapter>();

  register(adapter: OrchestratorModelAdapter) {
    this.adapters.set(adapter.model.id, adapter);
  }

  unregister(modelId: string) {
    this.adapters.delete(modelId);
  }

  get(modelId: string): OrchestratorModelAdapter | undefined {
    return this.adapters.get(modelId);
  }

  resolve(model: ModelRef, capability: OrchestratorCapability): OrchestratorModelAdapter {
    const adapter = this.get(model.id);
    if (!adapter) {
      throw new ModelAdapterNotFoundError(model.id);
    }

    if (!adapter.supports(capability)) {
      throw new ModelAdapterCapabilityError(model.id, capability);
    }

    return adapter;
  }
}
