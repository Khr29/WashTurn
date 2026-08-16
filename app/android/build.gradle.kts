allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
// Some plugin subprojects (e.g. share_plus 7.2.2) pin their own compileSdkVersion
// below what their AndroidX dependencies now require. Align every subproject's
// compileSdk with the app module's (36) without touching the plugin's own files
// or bumping its version. Must be registered before evaluationDependsOn(":app")
// below forces early evaluation of the app project.
subprojects {
    afterEvaluate {
        extensions.findByName("android")?.withGroovyBuilder {
            "compileSdkVersion"(36)
        }
    }
}

subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
