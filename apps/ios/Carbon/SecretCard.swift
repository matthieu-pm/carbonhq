import SwiftUI

struct SecretCard: View {
    @Environment(Store.self) private var store
    let key: SessionKey
    let request: SecretHandoff
    @State private var values: [String: String] = [:]
    @State private var keepFile = false
    @State private var sent = false
    @State private var failed = false

    private var fileOnly: Bool { request.target.kind == "file" && (request.target.command ?? []).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            CardHeader(symbol: "key.fill", text: "\(request.agent) requests a one-time secret")
            if request.state == "pending" && !failed {
                destination
                Text(request.purpose).font(Theme.Font.callout)
                ForEach(request.fields, id: \.name) { field in
                    VStack(alignment: .leading, spacing: Theme.Space.xs) {
                        Text(field.label).font(Theme.Font.meta)
                        SecureField(field.name, text: Binding(get: { values[field.name] ?? "" }, set: { values[field.name] = $0 }))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(Theme.Space.s)
                            .well()
                    }
                }
                if request.target.kind == "file" {
                    Toggle("Keep in \(request.target.path ?? "file")", isOn: $keepFile)
                        .disabled(request.keepBlocked != nil)
                    Text(request.keepBlocked ?? "Creates a new file and leaves it on disk. Existing files are never replaced.")
                        .font(Theme.Font.meta).foregroundStyle(Theme.secondary)
                }
                Text("Carbon passes a reference to the agent and discards its copy after use. The approved command, file or website can still expose the value.")
                    .font(Theme.Font.meta).foregroundStyle(Theme.secondary)
                TimelineView(.periodic(from: .now, by: 1)) { timeline in
                    let expired = timeline.date.timeIntervalSince1970 * 1000 >= request.expiresAt
                    Button(expired ? "Expired" : request.target.kind == "browser" ? "Fill and submit" : fileOnly ? "Keep in file" : "Run with secret") {
                        submit()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(sent || expired || (fileOnly && !keepFile) || request.fields.contains { (values[$0.name] ?? "").isEmpty })
                    .onChange(of: expired) { _, expired in if expired { values.removeAll() } }
                }
                Button("Deny") { deny() }
                    .buttonStyle(SecondaryButtonStyle(ink: Theme.destructive))
                    .disabled(sent)
            } else if request.state == "running" {
                destination
                ProgressView("Using the approved hand-off…")
            } else {
                Text(failed ? "Could not confirm the hand-off. Ask for a new request; it may already have run." : summary)
                    .font(Theme.Font.callout).foregroundStyle(Theme.secondary)
                if let message = request.message { Text(message).font(Theme.Font.meta).foregroundStyle(Theme.secondary) }
            }
        }
        .card(edge: Theme.accent.opacity(0.35))
        .onDisappear { values.removeAll() }
        .onChange(of: request.state) { _, state in if state != "pending" { values.removeAll() } }
    }

    private var summary: String {
        switch request.state {
        case "used": request.keepFile ? "Saved to \(request.target.path ?? "the approved file"). Carbon discarded its copy." : "Handed off once. Carbon discarded its copy."
        case "denied": "Declined. Nothing was shared."
        case "expired": "Expired. Nothing was shared."
        case "cancelled": "Withdrawn. Nothing was shared."
        default: "The hand-off failed. Carbon discarded its copy."
        }
    }

    @ViewBuilder private var destination: some View {
        if request.target.kind == "browser" {
            Text(request.target.origin ?? "").font(Theme.Font.code)
            ForEach(request.target.fields ?? [], id: \.name) { field in
                Text("\(field.name): \(field.selector)").font(Theme.Font.code)
            }
            Text("\(request.submitLabel ?? "Submit"): \(request.target.submit ?? "")").font(Theme.Font.code)
        } else {
            if let path = request.target.path { Text(path).font(Theme.Font.code) }
            Text((request.target.command ?? []).map { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }.joined(separator: " "))
                .font(Theme.Font.code)
            Text(request.cwd).font(Theme.Font.meta).foregroundStyle(Theme.secondary)
        }
    }

    private func submit() {
        guard !sent else { return }
        sent = true
        let submitted = values
        values.removeAll()
        Task {
            do {
                let _: JSON = try await store.call(key.server, "answer_secret_request", [
                    "sessionId": .string(key.id), "id": .string(request.id),
                    "values": .object(submitted.mapValues(JSON.string)), "keepFile": .bool(keepFile),
                ])
            } catch { failed = true }
        }
    }

    private func deny() {
        sent = true
        values.removeAll()
        Task {
            do {
                let _: JSON = try await store.call(key.server, "deny_secret_request", ["sessionId": .string(key.id), "id": .string(request.id)])
            } catch { failed = true }
        }
    }
}
