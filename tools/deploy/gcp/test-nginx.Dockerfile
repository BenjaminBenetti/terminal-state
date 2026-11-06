# Optional local integration test; production installs RPMs directly, no Docker.
FROM rockylinux/rockylinux:10
RUN dnf -y install epel-release dnf-plugins-core \
    && dnf config-manager --set-enabled crb \
    && dnf -y install nginx nginx-mod-brotli openssl curl brotli python3 diffutils \
    && dnf clean all
COPY nginx.conf cutoff.html test-nginx.sh /test/
ENTRYPOINT ["bash", "/test/test-nginx.sh"]
