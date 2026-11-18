package com.beaconremote.host

enum class LivePermission(val wire: String) { FILES("files"), CONTROL("control") }

data class LivePermissionPrompt(
    val sessionId: String,
    val id: String,
    val generation: Long,
    val timeoutMs: Long,
    val scope: LivePermission,
)

/** Written on the signaling worker. The channel workers read approval for their own peer generation. */
internal class LivePermissionRequest {
    private var pending: LivePermissionPrompt? = null
    private var deadline = 0L
    private var locallyApproved = false
    @Volatile private var approved = emptyMap<LivePermission, Long>()

    fun allowed(generation: Long, scope: LivePermission): Boolean = approved[scope] == generation
    fun find(id: String, generation: Long): LivePermissionPrompt? =
        pending?.takeIf { it.id == id && it.generation == generation }

    fun begin(prompt: LivePermissionPrompt, now: Long): Boolean {
        if (pending != null || allowed(prompt.generation, prompt.scope) || prompt.timeoutMs !in 1..30_000) return false
        pending = prompt
        deadline = now + prompt.timeoutMs
        locallyApproved = false
        return true
    }

    fun respond(id: String, generation: Long, allow: Boolean, now: Long): LivePermissionPrompt? {
        val prompt = pending ?: return null
        if (locallyApproved || prompt.id != id || prompt.generation != generation || now >= deadline) return null
        if (allow) locallyApproved = true else pending = null
        return prompt
    }

    fun commit(id: String, generation: Long, now: Long): Boolean {
        val prompt = pending ?: return false
        if (!locallyApproved || prompt.id != id || prompt.generation != generation || now >= deadline) return false
        pending = null
        approved = approved + (prompt.scope to generation)
        return true
    }

    fun cancel(id: String, generation: Long): Boolean {
        val prompt = pending ?: return false
        if (prompt.id != id || prompt.generation != generation) return false
        pending = null
        return true
    }

    fun cancelIfUnavailable(now: Long, available: Set<LivePermission>): LivePermissionPrompt? {
        val prompt = pending ?: return null
        if (prompt.scope in available && now < deadline) return null
        pending = null
        return prompt
    }

    fun detach() {
        pending = null
        approved = emptyMap()
    }
}
