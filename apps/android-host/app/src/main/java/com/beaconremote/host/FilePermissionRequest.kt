package com.beaconremote.host

data class FilePermissionPrompt(
    val sessionId: String,
    val id: String,
    val generation: Long,
    val timeoutMs: Long,
)

/** Written on the signaling worker. The file worker reads approval for its own peer generation. */
internal class FilePermissionRequest {
    private var pending: FilePermissionPrompt? = null
    private var deadline = 0L
    private var locallyApproved = false
    @Volatile private var approvedGeneration: Long? = null

    fun allowed(generation: Long): Boolean = approvedGeneration == generation

    fun begin(prompt: FilePermissionPrompt, now: Long): Boolean {
        if (pending != null || allowed(prompt.generation) || prompt.timeoutMs !in 1..30_000) return false
        pending = prompt
        deadline = now + prompt.timeoutMs
        locallyApproved = false
        return true
    }

    fun respond(id: String, generation: Long, allow: Boolean, now: Long): FilePermissionPrompt? {
        val prompt = pending ?: return null
        if (locallyApproved || prompt.id != id || prompt.generation != generation || now >= deadline) return null
        if (allow) locallyApproved = true else pending = null
        return prompt
    }

    fun commit(id: String, generation: Long, now: Long): Boolean {
        val prompt = pending ?: return false
        if (!locallyApproved || prompt.id != id || prompt.generation != generation || now >= deadline) return false
        pending = null
        approvedGeneration = generation
        return true
    }

    fun cancel(id: String, generation: Long): Boolean {
        val prompt = pending ?: return false
        if (prompt.id != id || prompt.generation != generation) return false
        pending = null
        return true
    }

    fun cancelIfUnavailable(now: Long, available: Boolean): FilePermissionPrompt? {
        val prompt = pending ?: return null
        if (available && now < deadline) return null
        pending = null
        return prompt
    }

    fun detach() {
        pending = null
        approvedGeneration = null
    }
}
