import SwiftUI

enum RecoveryKind: String, Decodable {
    case session, delivery, task, operation, unrecognized
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unrecognized
    }
}

enum RecoveryAction: String, Decodable {
    case resume, retry, inspect, unrecognized
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unrecognized
    }
}

struct WorkRecovery: Decodable, Identifiable {
    let id: String
    let kind: RecoveryKind
    let sessionId: String
    let title: String
    let reason: String
    let action: RecoveryAction
    let details: JSON
}

struct RecoveryNotice: View {
    @Environment(Store.self) private var store
    let key: SessionKey
    @State private var items: [WorkRecovery] = []
    @State private var failure: String?
    @State private var sending = false

    private var busy: Bool { store.items[key]?.busy ?? false }
    private var connected: Bool { store.serverState[key.server] == .connected }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            ForEach(items, id: \.kindAndId) { item in
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    Text("Work interrupted").font(Theme.Font.headline)
                    Text(item.reason).font(Theme.Font.meta).foregroundStyle(Theme.secondary)
                    if item.action == .resume || item.action == .retry {
                        Button(sending ? "Sending…" : item.action == .resume ? "Resume" : "Retry") {
                            Task { await recover(item) }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(sending || busy || !connected)
                    }
                    DisclosureGroup("Inspect") {
                        if let bytes = try? JSONEncoder().encode(item.details), let text = String(data: bytes, encoding: .utf8) {
                            Text(text).font(Theme.Font.code).textSelection(.enabled)
                        }
                    }
                    .font(Theme.Font.meta)
                    Button("Dismiss") { Task { await dismiss(item) } }
                        .disabled(sending || !connected)
                }
                .card()
            }
            if let failure {
                Text(failure).font(Theme.Font.meta).foregroundStyle(Theme.destructive)
                Button("Refresh recovery") { Task { await load() } }
            }
        }
        .task(id: "\(key.id)|\(busy)|\(connected)|\(store.items[key]?.modified ?? "")") {
            if connected { await load() }
        }
    }

    private func load() async {
        do {
            items = try await store.call(key.server, "list_work_recovery", ["sessionId": .string(key.id)])
            failure = nil
        } catch {
            if !error.localizedDescription.contains("unknown command") { failure = error.localizedDescription }
        }
    }

    private func dismiss(_ item: WorkRecovery) async {
        guard !sending, connected else { return }
        sending = true
        defer { sending = false }
        do {
            _ = try await store.call(key.server, "dismiss_work_recovery", [
                "sessionId": .string(key.id), "id": .string(item.id),
            ], as: JSON.self)
            await load()
        } catch { failure = error.localizedDescription }
    }

    private func recover(_ item: WorkRecovery) async {
        guard !sending, !busy, connected else { return }
        sending = true
        failure = nil
        defer { sending = false }
        do {
            let result: JSON = try await store.call(key.server, "recover_work", [
                "sessionId": .string(key.id), "id": .string(item.id), "action": .string(item.action.rawValue),
            ])
            if case .object(let fields) = result, case .string(let state) = fields["state"], ["failed", "uncertain", "canceled"].contains(state) {
                failure = "The continuation could not be submitted. Inspect the session before trying again."
            } else {
                await load()
            }
        } catch {
            failure = error.localizedDescription
        }
    }
}

private extension WorkRecovery {
    var kindAndId: String { "\(kind.rawValue)-\(id)" }
}
